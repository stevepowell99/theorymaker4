# Theorymaker

This repo hosts a static web app (pure HTML/CSS/JS) that turns **MapScript** (a small DSL) into **Graphviz DOT**, then renders it.

## MapScript (DSL) specification

### 1) File structure

MapScript is line-oriented. Blank lines are ignored.

- **Comments**: anything after `#` on a line is ignored.
- **Whitespace**: generally ignored around tokens (IDs, `::`, `->`, `|`, `:`).

### 2) Settings (optional)

Settings are written as `Key: Value` at the start of a line.

Supported keys (case-insensitive):

- **Title**: graph title (DOT `label`, top)
- **Background**: background colour (DOT `bgcolor`)
- **Default box colour** / **Default box color**: default node fill colour
- **Default box shape**: default node shape styling
  - `rounded` means Graphviz `style=rounded` on box-shaped nodes
- **Default box border**: default node border style (see “Border syntax”)
- **Default box shadow** / **Box shadow**: CSS shadow applied to rendered SVG nodes (not a Graphviz feature)
  - Allowed values: `none`, `subtle`, `medium`, `strong`, or a CSS filter `drop-shadow(...)`
- **Direction**: layout direction (maps to DOT `rankdir`)
  - Allowed values: `top-bottom`, `bottom-top`, `left-right`, `right-left`
- **Label wrap**: wrap node labels at N characters (best-effort)
- **Rank gap**: vertical spacing between ranks (DOT `ranksep`)
- **Node gap**: horizontal spacing between nodes (DOT `nodesep`)

Example:

Title: My new graph
Background: White
Default box colour: #ffeeba
Default box shape: rounded
Default box border: 1px dotted #666
Default box shadow: subtle
Direction: left-right
Label wrap: 20
Rank gap: 0.6
Node gap: 0.4

### 3) Nodes

Node definition syntax:

ID:: Label [attributes]

- **ID**: a token like `A`, `B2`, `my_node`
- **Label**: any text (can include spaces)
- **[attributes]**: optional, see below

Example:

A:: Actual text for A [colour=red | border=1px solid blue]

### 4) Edges

Edge syntax:

FROM1 | FROM2 -> TO1 | TO2 | TO3 [edge-options]

- Multiple sources/targets are separated by `|` and expand to multiple edges (cross product).
- Targets can be either an **ID** (preferred) or a **free label**.
  - If you use a free label, it implicitly creates a node whose label is that text.

Examples:

A -> B | C
A | Q -> B
A | Q -> B | C
D -> Needs no alias
D -> E [some edgelabel | 1px solid]

### 5) Clusters (grouping)

A cluster label line starts with `--`:

--A box containing B and C

All subsequent **node definitions** are placed into that cluster until another cluster label appears.

#### Nested clusters (boxes within boxes)

Use more dashes for deeper nesting:

- `--Label` opens a box (level 1)
- `----Label` opens a nested box (level 2)
- `----` closes the most recent level-2 box
- `--` closes the most recent level-1 box (and anything nested)

Example:

--Drivers
A:: Alice
B:: Bob

--Outcomes
C:: Crash risk

A -> C
B -> C

Example with explicit open/close (to avoid confusion):

--Outer box
A:: In outer
----Inner box
B:: In inner
----  # end inner
--    # end outer
C:: Not in any box

### 6) Attribute syntax

Attributes go inside `[...]` and are separated by `|`.

#### 6.1) Node attributes

Node attributes use `key=value` pairs.

Supported keys (case-insensitive):

- **colour** / **color**: node fill colour
- **background**: alias for fill colour
- **shape**: currently supports `rounded` (adds `style=rounded`)
- **border**: border style (see “Border syntax”)

Example:

A:: Hello [colour=#ff0000 | border=2px dashed #333]

#### 6.2) Edge options

Edge options are “positional” parts inside `[...]`:

[label | border]

- First part: edge label (string)
- Second part: border style (see “Border syntax”)

Example:

A -> B [increases | 1px dotted #888]

### 7) Border syntax

Border values are CSS-ish:

WIDTH STYLE COLOR

Examples:

1px solid blue
2px dotted #999

### 8) Full examples

#### Example A: Basic map

Title: Simple map
Direction: top-bottom

A:: Cause
B:: Effect
A -> B

#### Example B: Mixed IDs and implicit nodes

Title: Implicit nodes

A:: A (explicit)
A -> “A free label node”

#### Example C: Attributes and multi-target edges

Title: Attributes
Default box colour: #fff3cd
Default box border: 1px dotted #666

A:: Root cause [border=2px solid #0d6efd]
B:: Outcome
C:: Alternative outcome

A -> B | C [drives | 1px solid #999]
