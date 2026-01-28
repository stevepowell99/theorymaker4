# Theorymaker

## Intro

[Theorymaker](https://theorymaker.netlify.app) is for creating Theories of Change and similar diagrams. 

😀😇🎖️**Theorymaker is great because**:
- it is good at laying out even complicated diagrams easily, finding good positions for nodes and links. 
- each diagram is defined using a simple text language” which you can tweak if you want. 
- it's free! Later there might be a subscription to cover more AI use, more control over sharing, etc. 
- you can create and improve your diagram by:
  - just asking the AI 
  - clicking on different parts of the diagram to style them and add nodes and links and groups
  - editing the underlying text in the editor
  - or any combination of these.

🔥💥⛔**Use another tool** if you want:
- a different kind of diagram, which does not simply involve multiple nodes, links and grouping boxes
- custom positions for your diagram components. Theorymaker is opinionated about positioning (auto layout). It is not freeform drag-and-drop positioning
- to construct causal maps based on evidence, try [Causal Map](https://causalmap.app/)
- a mindmap to sketch our ideas, try [Biggerplate](https://www.biggerplate.com/)
- fully-featured ToC software with indicators, monitoring, etc. Try [TASO's tool](https://taso.org.uk/insights-and-evaluation/theory-of-change/) instead.

**This help** is split into tabs:

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
- **Save**: you can save maps **in this browser only** (LocalStorage). For a portable save you can use **Plain Link** (copy it, then bookmark or save it somewhere).
- **Questions or problems?**: [write to me](https://www.linkedin.com/in/stevepowell99/)!

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

### Diagram controls (Diagram tab)

Across the top of the diagram you have controls:

- **Zoom out / Reset / Zoom in**: zoom the diagram.
- **Diagram style** (palette): diagram-wide defaults (direction, spacing, colours, borders, etc).


- You can **scroll** to move around large diagrams.
- You can resize the left and right panels by dragging the broder between them.

#### Saving and sharing maps

- The URL updates as you type.
- Copy/paste the URL to share the exact same map with someone else (or to restore later). Or:
- **Save / share / export** (floppy menu):
  - **Save to this browser**: saves the current map into this browser only (LocalStorage). (This won’t sync to other devices.)
  - **Plain Link**: copies a plain URL that restores this map. This is the best option for sharing or saving somewhere else.
  - **Formatted link**: copies a clickable link (for docs/email) plus the plain URL.
  - **PNG image**: copies a PNG image to the clipboard (great for slides/docs).
  - **HTML package**: copies rich content for reports (title + image + link).

- Use **Save → Save to this browser** to store the current map **in this browser only**.
  - Saved maps appear in **Templates → Saved in this browser**.
  - Saved maps can be deleted from Templates (browser-only).
  - If you want to access the map from elsewhere, copy **Plain Link** and bookmark it or save the link somewhere.


### Editing the diagram by clicking

- Click a **node** to start a node selection (this opens the node drawer where you can style/rename).
- Click a **link** to edit its endpoints/label/styling or delete it.
- Click a **group box** to open the group drawer (style/rename/link).

### Adding and moving nodes and links with the checkboxes

- Use the **hover checkbox** to start selection mode:
  - Hover a **node** and click its checkbox → selects nodes (node drawer opens).
  - Hover a **group box** and click its checkbox → selects group boxes (group drawer opens).
- **Node selection mode** (1+ nodes selected):
  - Checkboxes appear on **nodes** (not groups) so you can multi-select.
  - Click a **node** to create link(s) to/from the selection (direction + styling are set in the drawer).
  - Click a **group box** to create link(s) to/from that group **alias** (needs `--a:: Title`).
  - **Shift+click** a group box to move the selected nodes into that group.
  - **Shift+click** the diagram background to move the selected nodes out of groups.
  - You can bulk-style selected nodes (label editing is disabled when multiple nodes are selected).
- **Group selection mode** (1+ group boxes selected):
  - Checkboxes appear on **groups** (not nodes) so you can multi-select groups.
  - Click a **node** to create link(s) between the selected group alias(es) and that node.
  - Click a **group box** to create link(s) between group alias(es).
  - You can bulk-style selected group boxes (title editing is disabled when multiple groups are selected).
- In both drawers:
  - The **Create new + link** button appears only after you type at least one label, and pressing **Enter** in the label input triggers it.


### Using the Editor

#### Editor keyboard shortcuts (Ace)

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

#### Styling quickly from the Editor

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

- If you link to an ID that you never defined with `ID:: ...`, it still appears as a node (**implicit node**). Its label will just be the ID.
- You can also use **free-label tokens** (with spaces) in links; they become implicit nodes too. Example: `Training quality -> Adoption` (no `::` needed).
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
- `--Alias:: Label` opens a group (level 1) **and** gives it an alias you can use in links
- `--[]` opens an **untitled** group (level 1)
- `----[]` opens an **untitled** nested group (level 2)
- `----` closes the most recent level-2 group
- `--` closes the most recent level-1 group (and anything nested)

Rules / gotchas:

- **Untitled opener must be explicit**: use `--[]` (or `--[border=...]`, etc). Plain `--` is always a closer.
- Boxes only contain nodes that are explicitly defined with `ID:: ...` while the box is open.
- If you use a group alias (`--Alias:: ...`), that alias **must not** also be used as a node ID.
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

Example (link to/from groups using aliases):

```
-- a:: Drivers
A:: Training quality
--
-- c:: Outcomes
C:: Adoption
--

a -> c
a -> A
```
Important rule (by design): **groups only contain nodes that appear as explicit alias lines (`ID:: ...`) while the box is open**. Links don’t “pull” nodes into groups.

Note: when you create links to/from group boxes using the **UI**, Theorymaker can auto-create a free alias for a group that doesn’t have one yet (it writes something like `-- g3:: My group` into the MapScript). In plain MapScript text, you still need an alias to write group links like `g3 -> A`.

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

### 9) Advanced notes (implicit nodes, group links)

Implicit nodes (created from links):

- If you write `A -> B` without defining `A:: ...` and `B:: ...`, those nodes still exist (implicit).
- If you write a **free label** like `Training quality -> Adoption`, the app creates an internal ID for it (a “slug”).
- **Editing/deleting implicit nodes via the UI**: if you click an implicit node to edit it (or click the red delete X), Theorymaker will automatically “promote” it by inserting an explicit `ID:: Label` line near the top of the script and rewriting relevant link endpoints to use that ID. (This keeps editing and deleting consistent.)

Group links (clusters):

- To link to/from a group in text, give it an alias: `-- g:: My group`, then link with `g -> A` or `A -> g`.
- The renderer draws group links using Graphviz’s cluster/compound edge routing so the arrow appears to touch the box.

### 10) Rank constraints (more control over layout)

Theorymaker uses auto-layout (Graphviz `dot`). You can *nudge* positioning by adding **rank constraints**.

Syntax:

- `rank=same: A | B | C` puts nodes on the same rank (same row/column depending on `Direction:`).
- `rank=min: A | B` tries to pull nodes toward the “start” of the diagram.
- `rank=max: A | B` tries to push nodes toward the “end” of the diagram.
- `rank=source: A | B` prefers nodes as sources (few/no incoming edges).
- `rank=sink: A | B` prefers nodes as sinks (few/no outgoing edges).
- `rank=0: ...`, `rank=1: ...` etc create explicit “layers”:
  - nodes within the same number share a rank
  - lower numbers are forced to appear earlier than higher numbers

Important rule (to keep groups working):

- A single `rank=...:` line must refer to nodes that are **all in the same group** (or **all ungrouped**).
- If you want to rank nodes in different groups, write **separate** `rank=...:` lines (one per group) and rely on numeric rank ordering for coarse ordering across the whole diagram.

Examples:

```
Direction: left-right

rank=same: Inputs | Activities | Outputs

Inputs:: Inputs
Activities:: Activities
Outputs:: Outputs
Inputs -> Activities -> Outputs
```

Numeric layering (explicit stages):

```
Direction: left-right

rank=0: Context | Baseline
rank=1: Inputs | Activities
rank=2: Outputs | Outcomes
rank=3: Impact

Context:: Context
Baseline:: Baseline
Inputs:: Inputs
Activities:: Activities
Outputs:: Outputs
Outcomes:: Outcomes
Impact:: Impact

Context | Baseline -> Inputs
Inputs -> Activities -> Outputs -> Outcomes -> Impact
```

You can also reference a **group alias** in ranks (it resolves to the first node inside that group):

```
Direction: left-right

-- a:: Drivers
A:: Training quality
--
-- b:: Outcomes
B:: Adoption
--

rank=same: a | b
a -> b
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

### Can I move nodes into/out of groups?

Yes: use the **checkbox selection** UI on nodes. With 1+ nodes selected, click a group box to move them into that group; click the diagram background to move them out to top-level.

Limitations:

- This only works for nodes with an explicit `ID:: ...` line.
- The target group must have a closing line (`--` / `----`) for the move to work.

### How do I link to/from a group box?

- In MapScript: give the group an alias with `-- g:: Group title`, then use it like a node in links: `g -> A` or `A -> g`.
- In the UI: you can click group boxes as link targets. If a box has no alias yet, Theorymaker may auto-create one (you’ll see a `g1`, `g2`, … alias added to the group line).

### How do I clear selection / close drawers quickly?

Press **Esc**. It clears all selections and closes the selection/group drawers.

### When I delete a node, why are some links still there?

If your links use the multi-link `|` syntax (e.g. `A | X -> B | C`), deleting `X` removes it from inside that line (resulting in `A -> B | C`). If removing the node would leave a link with no sources or no targets, the whole link line is removed.
