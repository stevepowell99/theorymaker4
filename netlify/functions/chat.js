// Netlify Function: proxy for Dify API and enforce a simple daily per-IP limit.
const DAILY_QUERY_CHAR_LIMIT = 200000; // 200k submitted characters per IP per UTC day. Say a large map with 10K characters can be tweaked 20 times a day.

function getClientIp(event, context) {
  // Netlify exposes the client IP differently in prod/local, so check the common places.
  return String(
    context?.ip ||
      event.headers?.["x-nf-client-connection-ip"] ||
      event.headers?.["client-ip"] ||
      event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      "unknown"
  );
}

function getUsageKey(ip) {
  // Keep one usage record per IP per UTC day.
  const day = new Date().toISOString().slice(0, 10);
  return `${day}:${ip}`;
}

function getUsageHeaders(charsUsed) {
  return {
    "Content-Type": "application/json",
    "X-TM-Usage-Chars": String(charsUsed),
    "X-TM-Usage-Limit": String(DAILY_QUERY_CHAR_LIMIT),
  };
}

exports.handler = async (event, context) => {
  // Only allow GET (read usage) and POST (send chat).
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Get API key from environment variable
  const apiKey = process.env.DIFY_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "DIFY_API_KEY not configured" }),
    };
  }

  try {
    // Persist usage in Netlify Blobs so the limit survives serverless cold starts.
    const { getStore } = await import("@netlify/blobs");
    const usageStore = getStore("chat-usage");

    const clientIp = getClientIp(event, context);
    const usageKey = getUsageKey(clientIp);
    const usage =
      (await usageStore.get(usageKey, { type: "json" })) || { chars: 0 };
    const charsUsed = Number(usage?.chars) || 0;

    if (event.httpMethod === "GET") {
      return {
        statusCode: 200,
        headers: getUsageHeaders(charsUsed),
        body: JSON.stringify({
          chars: charsUsed,
          limit: DAILY_QUERY_CHAR_LIMIT,
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const query = String(body.query || "").trim();

    if (!query) {
      return {
        statusCode: 400,
        headers: getUsageHeaders(charsUsed),
        body: JSON.stringify({ error: "Missing query" }),
      };
    }

    const submittedChars = query.length;
    const nextCharsUsed = charsUsed + submittedChars;

    if (nextCharsUsed > DAILY_QUERY_CHAR_LIMIT) {
      return {
        statusCode: 429,
        headers: getUsageHeaders(charsUsed),
        body: JSON.stringify({
          error: "Daily chat limit reached for this IP",
        }),
      };
    }

    // Count the submission before forwarding so repeated attempts still consume quota.
    await usageStore.setJSON(usageKey, {
      chars: nextCharsUsed,
      updatedAt: new Date().toISOString(),
    });

    // Forward request to Dify
    const response = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.text();

    return {
      statusCode: response.status,
      headers: getUsageHeaders(nextCharsUsed),
      body: data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};








