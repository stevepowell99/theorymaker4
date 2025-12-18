# Theorymaker spec

This is a pure html/js repo. It will be committed to github and from there hosted on netlify. 
Very minimalist styling: simple navbar with theorymaker as brand on left. 
main panel has a draggable vertical border between narrower editor on the left and main on the right.
main panel has three tabs which are just text along the top:
viz | gallery | help

editor contains a ace editor which will contain our code
viz contains a graphviz dot viz, I think powered by webAssembly? displaying the result of the code on the left.

code is not DOT, it is our own DSL which is internally first validated (and lightly autocorrected) then converted into DOT, which is then visualised.

## Our DSL
### example.

Colours: use named colours (e.g. `red`, `aliceblue`) or `rgb(r,g,b)`. Note: `#` starts comments in MapScript, so `#hex` colours are not supported.

# Styles
Background: aliceblue
Default box colour: red
Default box shape: rounded
Default box shadow: strong
Default box border: 1px dotted green
Direction: right-left
Label wrap: 20 characters
Rank gap: 2
Node gap: 2

# Contents
Title: My new graphete

## Nodes (and grouping boxes)
A:: Actual text for A[colour=red | border=1px solid blue]  # be flexible how we parse background and border parameters
--A grouping box containing B and C
B:: Text for B
----An inner grouping box containing C
C:: Text for C
--                               # end of box to avoid confusion
F:: some text not in any box

## Links
A -> B | C            # note this creates arrows to B and to C 
D -> Needs no alias   # boxes and their labels can be created like this too
P | Q -> D | E        # create multiple links like this
P -> E [some edgelabel | 1px solid]   # note edge specification



## Editor
add button to save to localstorage under a user-defined sanitised name. add a warning that map is only saved in the browser; recommended to also save the actual URL somewhere safe. on save, also store a screenshot and serve all localstorage maps at the beginning of the gallery


## URL
URL should constantly reflect the contents of the editor and restore the URL to editor on load


## Viz
enable panning with mouuse
across the top of the graphviz output, put:
- usual zoom / reset controls
- button to capture raw URL (for restore)
- button to capture high-quality png of the viz
- button to capture a formatted link i.e. <a href=foobar>Link</a>
- button to capture a html package containing high-quality png of the viz plus a formatted link, for pasting into reports.

### Viz interactivity
Click nodes and links to pop up a modal:
- delete
- change label
- change styling (node attrs / link border)

## Help
is fed by help.md, but with the existing quick reference on top. 

## Admin (local dev)
When running locally on `http://localhost/...` (Live Server), you are treated as **admin**:
- Editor **Save** lets you choose “save as normal user” (LocalStorage) or “copy standard example snippet” (paste into `GALLERY_EXAMPLES` in `examples.js`).
- Gallery has an admin-only **Rebuild thumbnails** button.

## Gallery

Provide a nice gallery with say 16 example maps with different styles and contents -- some simple, some more complicated. On click we get a warning: either cancel, or replace entire contents of editor, or just update editor with styles, not contents. 


## License

CC BY‑NC 4.0 (see `LICENSE`).


