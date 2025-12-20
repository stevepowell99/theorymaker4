# Theorymaker

## Intro

Theorymaker is for creating Theories of Change and similar diagrams. 

🔥💥⛔**Use another tool** if:
- If you want a different kind of diagram, which does not simply involve multiple nodes, links and grouping boxes
- If you want custom positions for your diagram components. Theorymaker is opinionated about positioning. It is not drag-and-drop.
- If you want fully-featured ToC software with indicators, monitoring ...

😀😇🎖️**Theormaker is great because**:
- it is good at laying out even complicated diagrams easily, finding good positions for nodes and links. 
- it is based on a simple text “map language” called **MapScript**. 
- you can create and improve your diagram by:
  - just asking the AI 
  - clicking on different parts of the diagram to style them and add nodes and links and groups
  - editing the underlying text in the editor
  - or any combination of these.

This help is split into tabs:

- **intro**: the basics (start here)
- **usage**: how the app works (URL, templates, editing the diagram)
- **ai**: how chat works + privacy
- **syntax**: MapScript reference (copy/paste friendly)
- **quickref**: a small example you can copy
- **admin**: local-dev-only tools (only visible on `localhost`)

### Need to know (start here)

- **Your map is defined by the text in the Editor**. Everything else is derived from it. 
- **Share/restore via URL**: the URL updates as you type. Copy/paste the URL to restore the exact same map later.
- **Undo / Redo**: use the top-right buttons (these mirror browser Back/Forward).
- **Templates**: load an example, or load maps you saved in this browser.
- **Save**: you can save your maps into this browser only (LocalStorage).

### What are “nodes”, “links”, and “groups”?

- **Nodes** are the boxes.
- **Links** are the arrows.
- **Groups** are grouping boxes (containers) around related nodes.

## Usage

### The main areas

- **Left**: Chat (optional) + Editor (MapScript)
- **Diagram** (tab): the rendered map + controls
- **Templates** (tab): examples + maps you saved in this browser
- **Help** (tab): this page

Tip: there’s also a **Tour** button (magic wand) in the navbar.

### Editor keyboard shortcuts (Ace)

Most useful (Windows):

- **Find**: `Ctrl+F`
- **Replace**: `Ctrl+H`
- **Go to line**: `Ctrl+L`
- **Add next instance of current selection**: `Alt+Ctrl+Right`
- **Duplicate line/selection**: `Ctrl+Shift+D`
- **Multi-cursor (add above/below)**: `Ctrl+Alt+Up` / `Ctrl+Alt+Down`
- **Multi-cursor (add at click)**: `Alt+Click`
- **Toggle comment**: `Ctrl+/`
- **Indent / outdent**: `Tab` / `Shift+Tab`

### Diagram controls (Diagram tab)

Across the top of the diagram you have controls:

- **Zoom out / Reset / Zoom in**: zoom the diagram.
- **Save** (floppy): save the current map into this browser (LocalStorage).
- **Share / export** (box-with-arrow menu):
  - **Raw URL**: copies the current restore URL (it already contains the MapScript).
  - **Formatted link**: copies an HTML `<a href="...">...</a>` link.
  - **PNG image**: downloads a high-quality PNG.
  - **HTML package**: downloads a small HTML file containing the PNG + a link.
- **Diagram style** (palette): diagram-wide defaults (direction, spacing, colours, borders, etc).

Tips:

- You can **scroll** to move around large diagrams.
- You can resize the left and right panels by dragging the broder between them.

### Sharing / restoring (URL)

- The URL updates as you type.
- Copy/paste the URL to share the exact same map with someone else (or to restore later).

### Saving maps (LocalStorage)

- Click **Save** to store the current map **in this browser only**.
- Saved maps appear in **Templates → Saved in this browser**.
- Saved maps can be deleted from Templates (browser-only).

### Editing the diagram with clicks

- Click a **node** to change its label/styling or delete it.
- Click a **link** to change its endpoints/label/styling or delete it.
- Click a **group box** to edit its title/styling.

### Styling quickly from the Editor

In the Editor, when your cursor is on a styleable line, a small **Style** button appears near the cursor:

- Node line: `ID:: Label [...]`
- Link line: `A -> B [...]`
- Group line: `--Group name [...]`
- Setting line: `Key: Value` (opens a focused “Edit setting” drawer)

## AI

Use the chat box (left panel) if you want help editing your map in plain English.

How it works (simple version):

- You describe what you want to change, e.g. “Add a node for Training and connect it to Adoption”.
- Theorymaker asks an AI to propose an updated map.
- The app applies the update and redraws the diagram.

Good ways to use it:

- **Start a map quickly**: describe the topic and ask for a first draft.
- **Make bigger edits**: “group these nodes”, “add missing drivers”, “simplify the structure”.
- **Then refine manually**: small wording/styling tweaks are often faster by hand in the Editor.

Important notes:

- **Optional**: you can ignore chat entirely and just edit manually.
- **Privacy**: when you use chat, your current map text is sent to an external AI service (Dify) to generate a suggested update.
- **API keys**:
  - **Production (hosted)**: the API key is stored server-side (Netlify environment variable) and you will not be prompted.
  - **Local dev (localhost only)**: you’ll be prompted for a Dify App API key; it is stored in this browser only (`localStorage["tm_dify_api_key"]`).

## Admin

Admin features are enabled **only when running locally** on `http://localhost/...` (Live Server).

- **Rebuild thumbnails**: Templates → **Rebuild thumbnails** (admin-only).
- **Save as standard example**: Diagram → **Save** → **Copy standard example snippet**, then paste the snippet into `GALLERY_EXAMPLES` in `examples.js`.

## Syntax


### 0) The smallest possible map

Paste this into the editor:

```
A:: Cause
B:: Effect
A -> B
```
### 1) Recommended structure

MapScript is flexible: you *can* mix node aliases, boxes, and links anywhere.

But it’s good style (and easiest to understand) to write in this order:

- **Settings** (optional) at the top: `Key: Value`
- **Aliases + boxes** next: `ID:: Label` and `--...` box markers
- **Links** last: `A -> B`


### 2) Comments (important)

- `#` starts a comment.
- Everything after `#` on that line is ignored.

This also means: **don’t use `#` for hex colours** (`#ff0000`) because it will be treated as a comment.

### 3) Settings (styles at the top)

Settings look like `Key: Value` and usually go near the top.

Common settings:

- **Title**: text title shown above the diagram. You can also style the title inline:
  - `Title: My title [text colour=dimgray | text size=22]` (title-only; does not change edge label colours)
- **Title position**: where the title is placed: `bottom-left | bottom-centre | bottom-right | top-left | top-centre | top-right`.
- **Background**: background colour (named colour or `rgb(r,g,b)`).
- **Text colour**: default text colour for the **edge labels** (and the title if the Title line has no title-only styling).
- **Default node text colour**: default text colour for **node labels**.
- **Default group text colour**: default text colour for **group titles**.
- **Default node colour**: default node fill colour.
- **Default node border**: default node border, like `1px solid gray`.
- **Default link colour**: default link/arrow colour.
- **Default link style**: `solid | dotted | dashed | bold`.
- **Default link width**: a number (interpreted like px), e.g. `2`.
- **Default node shape**: `rounded` for rounded nodes.
- **Default node shadow**: `none | subtle | medium | strong`.
- **Direction**: `top-bottom | bottom-top | left-right | right-left`.
- **Label wrap**: wraps node labels after N characters (best-effort).
- **Spacing along / Spacing across**: spacing controls (small numbers like `2`–`8` are typical).

Manual line breaks (override wrap):

- You can force line breaks inside **any label** (nodes, links, group titles, and the diagram title) by writing `///` inside the label text.
- When `///` is used, the normal **Label wrap** behavior is **switched off for that item**.

Examples:

```
A:: A long label///with a manual break
A -> B [increases///then decreases]
--A group title///with two lines
Title: My title///with a subtitle
```

Colour rules (keep it simple):

- Use **named colours** like `red`, `aliceblue`, `seagreen`, `dimgray`, etc.
- Or use **`rgb(r,g,b)`**, e.g. `rgb(255, 0, 0)`.

Example style block:

```
Background: aliceblue
Text colour: dimgray
Default node text colour: black
Default group text colour: black
Default node colour: wheat
Default node shape: rounded
Default node border: 1px dotted dimgray
Default link colour: dimgray
Default link style: dotted
Default link width: 2
Default node shadow: subtle
Direction: left-right
```

### 4) Nodes

Define a node like this:

ID:: Label

- **ID** is a short name you use in links (like `A`, `B2`, `MyNode`).
- **Label** is what you see in the diagram (can include spaces).

Examples:

```
A:: A short label
B:: A longer label with spaces
```

### 5) Links (arrows)

Links look like this:

```
A -> B
```

Notes:

- If you link to an ID that you never defined with `ID:: ...`, it still appears as a node (implicit node). Its label will just be the ID.
- **Implicit nodes are never put inside grouping boxes**. To put a node in a box (or style it, or reuse it reliably), define it explicitly with `ID:: Label`.

You can create multiple links in one line using `|`:

```
A -> B | C
A | Q -> B
A | Q -> B | C
```

(That last one creates the full cross-product: A→B, A→C, Q→B, Q→C.)

Optional link label + border:

```
A -> B [increases | 1px dotted gray]
```

Flexible link styling (partial specs):

- Parts inside `[...]` are separated by `|`.
- If the **first** part looks like a style token (colour / width / style), it is treated as **style**, not a label.
- Anything you don’t specify uses the diagram defaults (Default link colour/style/width).

Examples:

```
A -> B [seagreen]                  # colour only
A -> B [increases | 1px]           # label + width only
A -> B [increases | dotted]        # label + style only
A -> B [increases | solid seagreen]# label + style + colour
```

Optional link label style + size (use `key=value` inside the brackets):

```
A -> B [label=increases | border=1px dotted gray | label style=italic | label size=10]
```

### 6) Grouping boxes (optional)

Grouping boxes are just lines starting with dashes:

- `--Label` opens a group (level 1)
- `----Label` opens a nested group (level 2)
- `--[]` opens an **untitled** group (level 1)
- `----[]` opens an **untitled** nested group (level 2)
- `----` closes the most recent level-2 group
- `--` closes the most recent level-1 group (and anything nested)

Rules / gotchas:

- **Untitled opener must be explicit**: use `--[]` (or `--[border=...]`, etc). Plain `--` is always a closer.
- Boxes only contain nodes that are explicitly defined with `ID:: ...` while the box is open.
- Good style is to put boxes + aliases first, then links last. (You can mix them, but it’s harder to read.)

Example:

```
--Drivers
A:: Training quality
B:: Tool usability
--

--Outcomes
C:: Adoption
D:: Error rate
--

A | B -> C | D
```
Important rule (by design): **groups only contain nodes that appear as explicit alias lines (`ID:: ...`) while the box is open**. Links don’t “pull” nodes into groups.

### 6b) Styling groups (optional)

You can add a style list to a group title line:

```
--Drivers [colour=aliceblue | border=2px dotted dimgray | text colour=dimgray | text size=1.2]
```

Untitled groups can also be styled:

```
--[colour=aliceblue | border=2px dotted dimgray]
```

Supported group attributes:

- `colour=...` (or `color=...`, `background=...`): fill colour
- `border=...`: border like `2px solid gray`
- `text colour=...` (or `text color=...`): title text colour
- `text size=...` (or `text scale=...`): relative title text size multiplier like `1.2` or `80%`

### 7) Styling nodes inline (optional)

You can put a small “style list” after a node label:

```
A:: Hello [colour=red | border=2px dashed dimgray | shape=rounded]
```

Supported node attributes:

- `colour=...` (or `color=...`): fill colour
- `background=...`: fill colour (alias)
- `border=...`: border like `2px solid gray`
- `shape=rounded`: rounded corners
- `text size=...` (or `text scale=...`): relative node text size multiplier like `1.2` or `80%`

### 8) Border syntax (for nodes and links)

Border text is:

```
WIDTH STYLE COLOUR
```

Examples:

```
1px solid blue
2px dotted gray
```

## FAQ

### How do I force a line break in a label?

Use `///` inside the label text. It creates a manual newline and disables auto-wrapping for that label:

```
A:: My long label///breaking here
```

### Why doesn’t `#ff0000` work for colours?

Because `#` starts a comment in MapScript. Use named colours (e.g. `red`) or `rgb(r,g,b)` instead.

### Why aren’t my linked nodes appearing inside groups?

Groups only contain nodes that are explicitly defined with `ID:: ...` while the group is open; links don’t “pull” nodes into groups.
