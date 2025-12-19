# Theorymaker

## Intro

Theorymaker lets you write a simple text “map language” called **MapScript** and instantly see it as a diagram.

You can work in three ways:

- **Manual**: write MapScript directly in the Editor.
- **AI**: ask the chat to update the diagram for you.
- **Combination**: use AI for a first draft, then tweak/refine manually (or vice versa).

If you’re new: think of it like this:

- **Nodes** are the boxes in the diagram.
- **Links** are arrows between nodes.
- **Grouping boxes** are visual containers that group related nodes.

## Usage

### The 3 areas

- **Editor (left)**: where you type MapScript.
- **Viz (right)**: the rendered diagram.
- **Gallery**: example maps + maps you saved in this browser.

### Editor keyboard shortcuts (Ace)

Most useful (Windows):

- **Find**: `Ctrl+F`
- **Replace**: `Ctrl+H`
- **Go to line**: `Ctrl+L`
- **Duplicate line/selection**: `Ctrl+Shift+D`
- **Multi-cursor (add above/below)**: `Ctrl+Alt+Up` / `Ctrl+Alt+Down`
- **Multi-cursor (add at click)**: `Alt+Click`
- **Toggle comment**: `Ctrl+/`
- **Indent / outdent**: `Tab` / `Shift+Tab`

### Map controls (Viz tab)

Across the top of the diagram you have controls:

- **Zoom out / Zoom in**: zoom the diagram.
- **Reset (fit to width)**: fits the diagram to the available panel width again.
- **Copy raw URL**: copies the current “restore URL” (the MapScript is encoded into it).
- **Copy PNG**: copies a high-quality PNG image.
- **Copy link**: copies a formatted HTML `<a href="...">...</a>` link.
- **Copy HTML**: copies an HTML “package” containing a high-quality PNG + a link (useful for reports).

Tips:

- If you resize the editor splitter, the diagram will refit while you’re in the default “fit to width” mode.
- Once you zoom manually, the app keeps your zoom level until you hit **Reset**.

### Sharing maps (URL)

- The URL updates as you type.
- Copy/paste the URL to share the exact same map with someone else (or to restore later).

### Saving maps (LocalStorage)

- Click **Save** to store the current map **in this browser only**.
- Saved maps appear at the top of **Gallery**.

### Editing the diagram with clicks

- Click a **node** to change its label and styling or delete it.
- Click a **link** to change its endpoints/label/border or delete it.

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
- **Privacy**: when you use chat, your current map text is sent to an external AI service to generate a suggested update.
- **API key**: you may be prompted to paste an API key the first time you use chat (it’s stored only in this browser).

## Admin

Admin features are enabled **only when running locally** on `http://localhost/...` (Live Server).

- **Rebuild thumbnails**: Gallery → **Rebuild thumbnails** (admin-only).
- **Save as standard example**: Editor → **Save** → **Copy standard example snippet**, then paste the snippet into `GALLERY_EXAMPLES` in `examples.js`.

## Syntax

This section is meant to be copy/paste friendly.

### 1) The smallest possible map

Paste this into the editor:

```
A:: Cause
B:: Effect
A -> B
```

### 2) Comments (important)

- `#` starts a comment.
- Everything after `#` on that line is ignored.

This also means: **don’t use `#` for hex colours** (`#ff0000`) because it will be treated as a comment.

### 3) Settings (styles at the top)

Settings look like `Key: Value` and usually go near the top.

Common settings:

- **Title**: text title shown above the diagram.
- **Background**: background colour (named colour or `rgb(r,g,b)`).
- **Default box colour**: default node fill colour.
- **Default box border**: default node border, like `1px solid gray`.
- **Default link colour**: default link/arrow colour.
- **Default link style**: `solid | dotted | dashed | bold`.
- **Default link width**: a number (interpreted like px), e.g. `2`.
- **Default box shape**: `rounded` for rounded nodes.
- **Default box shadow**: `none | subtle | medium | strong`.
- **Direction**: `top-bottom | bottom-top | left-right | right-left`.
- **Label wrap**: wraps node labels after N characters (best-effort).
- **Rank gap / Node gap**: spacing controls (small numbers like `2`–`8` are typical).

Colour rules (keep it simple):

- Use **named colours** like `red`, `aliceblue`, `seagreen`, `dimgray`, etc.
- Or use **`rgb(r,g,b)`**, e.g. `rgb(255, 0, 0)`.

Example style block:

```
Background: aliceblue
Default box colour: wheat
Default box shape: rounded
Default box border: 1px dotted dimgray
Default link colour: dimgray
Default link style: dotted
Default link width: 2
Default box shadow: subtle
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

Optional link label style + size (use `key=value` inside the brackets):

```
A -> B [label=increases | border=1px dotted gray | label style=italic | label size=10]
```

### 6) Grouping boxes (optional)

Grouping boxes are just lines starting with dashes:

- `--Label` opens a grouping box (level 1)
- `----Label` opens a nested grouping box (level 2)
- `----` closes the most recent level-2 grouping box
- `--` closes the most recent level-1 grouping box (and anything nested)

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

### 6b) Styling grouping boxes (optional)

You can add a style list to a grouping box title line:

```
--Drivers [colour=aliceblue | border=2px dotted dimgray | text colour=dimgray | text size=1.2]
```

Supported grouping box attributes:

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
