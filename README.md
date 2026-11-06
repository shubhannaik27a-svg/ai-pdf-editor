# AI PDF Editor

## Run (3 commands)
```
cd ai-pdf-editor
npm install
npm start
```
Open http://localhost:3000 (needs Node 18+). `npm start` automatically frees port 3000 if an old copy is still running.

## API key (never stored in the code)
Set the environment variable `AI_API_KEY`, then restart the terminal.
- Groq keys (start with `gsk_`) are detected automatically (default model `openai/gpt-oss-120b`; Groq made llama-3.3-70b-versatile Enterprise-only). Anthropic keys also work.
- Optional: `AI_MODEL` (text model), `AI_VISION_MODEL` (model used when screenshots are sent; default `qwen/qwen3.8-27b`, a Groq preview model, so if Groq retires it set this to another vision model your account lists), `AI_PROVIDER=groq`, `PORT`.
- Windows: `setx AI_API_KEY "gsk_..."` (then open a new terminal). macOS/Linux: add `export AI_API_KEY="..."` to `~/.zshrc` or `~/.bashrc`.
- A `.env` file (copy `.env.example`) also works.

## Which features use AI
**No AI (instant, free, work even without an API key):** **Word (.docx) to PDF (fit & fill)**, open / preview / download PDFs, zoom, page thumbnails, add / delete / reorder pages, select text or a region, double-click to edit text, add text / images, undo / redo, `replace X with Y` (any number of matches), **Erase selection / Delete key (also closes the gap)**, colour picker, arrow-key / arrow-button moving, flattened secure download. **Template + Results (lab manual format)**, Chat commands like `delete this`, `make this red`, `replace A with B` are recognised and run locally too (the chat shows `[local]`).

**Uses AI (needs `AI_API_KEY`):** **Screenshot -> Report**, generating a PDF from a prompt, rewriting text, and complex edits ("move education above experience", "add my phone number below my email", "remove my address" when nothing is selected). The AI only decides *what* to change; the app's own code does the actual PDF editing and layout, so the AI cannot corrupt the file.

## Doc -> PDF (exact copy of the Word file)
Small button **Doc -> PDF** in the top bar (next to Find / Replace): pick a `.docx` and the PDF opens in the editor straight away, no dialog. The same mode is the first option (ticked by default) in the **Word -> PDF** dialog. No AI, no server, runs in the browser (`public/docx2pdf.js` + `public/vendor/jszip.min.js`).
- **Nothing is resized:** the PDF uses the page size and margins stored in the Word file (Letter stays Letter), pictures keep their Word size, and pages break where Word breaks them. There is no fit & fill.
- **Pictures all have the same width:** pictures that are (almost) as wide as the text area are set to exactly the full text width, so a column of screenshots lines up. (Pictures that are clearly smaller keep their own size.)
- Text keeps bold / italic / underline / colour / size, alignment, spacing, indents, bullets and numbering, tabs; tables keep grid widths, borders, shading and merged cells.
- Limits: standard PDF fonts only (Calibri / Arial -> Helvetica, Cambria / Times -> Times, Consolas / Courier New -> Courier), so line breaks of text-heavy files can differ slightly from Word; headers, footers, text boxes and shapes are not drawn (a note tells you); a table row taller than one page is not split.
- Untick *Exact copy* in the Word -> PDF dialog to get the old re-flow / fit & fill behaviour.

## Word -> PDF (fit & fill)
Toolbar button **Word -> PDF** (or the home-screen card). Choose a `.docx` (a `.txt` also works), pick paper / font / margins and press *Convert to PDF*. The result opens in the editor like any other PDF. It runs entirely in the browser: no AI key, no server call (reader: `public/vendor/mammoth.browser.min.js`, engine: `public/docx2pdf.js`).
- **Sequence is kept:** headings, paragraphs, bold / italic / underline, bullet and numbered lists, tables and pictures come out in exactly the order they have in the Word file.
- **Fit & fill (on by default):** the converter tries many text/image scales (text roughly 8.8-14 pt for an 11 pt base) and keeps the one that leaves the least blank space, so the last page is not left half empty and nothing is cut off.
- **No gaps in between:** a picture that does not fit under the previous content is shrunk to the space that is left (down to 55 % of its size), otherwise it moves to the next page. Blank space still left at the bottom of a page is then absorbed: pictures on that page grow a little, then line spacing, then the gaps between blocks. Headings stay with the text after them, a one-line caption stays with its picture, a small table is never split, and a table row taller than a page is cut line by line instead of being lost.
- Untick *Fit & fill pages* for a plain 1:1 flow. Page numbers and justified text can be switched off in the same dialog.
- Limits: standard PDF fonts only (accented Latin letters work; other scripts show as `?`, Greek letters are written as words such as delta); the size of pictures, fonts and colours from Word are not copied (everything is re-flowed, which is what makes the fit possible); vector pictures (EMF / WMF) are skipped and reported; legacy `.doc` must be saved as `.docx` first; headers / footers / text boxes of the Word file are not included.

## Using it
- **Photo to PDF:** analyze a photographed document page with the vision API, then create a PDF that preserves that exact page image and adds an invisible OCR text layer for searching/selecting recognized words. This keeps handwriting, diagrams, layout and artwork intact; AI analysis is shown for review. The PDF can still be created if AI is unavailable. OCR language is currently English.

- **Generate:** chat mode "Generate new PDF" -> e.g. "Create a professional software engineer resume".
- **Edit:** Open a PDF, click / shift-click text or drag a region, then use the toolbar or chat. Double-click text to edit by hand.
- **Erase:** Delete key or "Erase selection". With "close gap" ticked, everything below (text, lines, images) moves up. Shift+Delete erases without moving. Erasing only part of a line, or an image-only region, erases without moving. A region drag is how you remove an image or logo.
- **Screenshot -> Report (AI):** toolbar button. Choose PDF 1 (lab manual format) and up to 10 screenshots of your output (used in file-name order); PDF 2 (a finished sample report) is optional. Step 1: the AI reads each screenshot separately (one request per screenshot, so none is skipped), tells you what it sees in order and asks what kind of PDF you want. Step 2: you reply in the chat (e.g. `experiment report, Experiment No 5, Computer Networks`); the AI writes Aim / Theory / Procedure / Observation / Result / Conclusion from what is visible, and the app places that text and ALL your screenshots (always in order, in one Output section) inside the PDF 1 frame (border, header, footer, page number). If you add PDF 2, its section names and writing style are copied and its college logo header is reused. The AI is told not to invent numbers; things it could not confirm are listed in the chat for you to check. Type `redo <instructions>` to regenerate, `cancel` to stop. You can still edit the result afterwards like any PDF.
- **Template + Results (lab manual):** toolbar button; PDF 1 = format (border, header, footer), PDF 2 = your experiment pages. Each page of PDF 2 is placed unchanged inside the frame of PDF 1, so the logo, fonts, tables and screenshots stay exactly as they are. Blank pages of PDF 2 are skipped. The footer placeholder ("Write Page No") is replaced by a real page number starting at the number you enter; leave the box empty to keep the placeholder. No AI and no API key needed.
- Undo/redo: Ctrl+Z / Ctrl+Y. Edits of more than 8 AI changes show a preview (Apply/Cancel).

## Important limits
- Edits cover old content with white and redraw text in standard fonts. Erased text is hidden and removed from the app's editable view, but it can still exist inside the downloaded PDF file (copy/paste or search might find it). For sensitive erasing use **Download flattened (secure)**, which turns pages into images (permanent removal; not editable/searchable afterwards).
- Images/logos are removed by selecting a region. 
- Quality depends on the AI model; always review before downloading.

## Rate limits
Screenshot -> Report makes one vision call per screenshot (each image counts as about 2,048 tokens) plus one text call to write the report. If Groq answers 429 (rate limit), the server now waits the time Groq asks for (up to 45 s) and retries by itself, so with several screenshots the run can take a minute on the Free plan.

Groq limits apply per organization, not per key. The Free plan allows roughly 30 requests/min, 1,000 requests/day, **8,000 tokens/min** and 200,000 tokens/day on `openai/gpt-oss-120b` (check console.groq.com/settings/limits for yours). To stay under that, the app sends at most 350 text items per edit (`LIM` in `public/index.html`) and caps AI output at 4,000 tokens (`AI_MAX_TOKENS`). If you are on a paid plan, raise these.

## Vision model
If the vision model in `AI_VISION_MODEL` is not available to your key, the server looks at your account's model list, picks a vision-capable one automatically (and prints which one in the terminal). Set `AI_VISION_MODEL` to that name to make it permanent.

## Replace X with Y
Messages like `replace terraform with shubhan` run instantly inside the app (no AI call, any number of matches, capitalisation kept: Terraform -> Shubhan, TERRAFORM -> SHUBHAN). It replaces everywhere unless you have text selected and don't say "everywhere". Text split across separate PDF text pieces (e.g. a line break in the middle of a phrase) can be missed; if nothing matches, the request goes to the AI instead.

## What's new
- **Cover + text: 43 font styles and exact colour picking.** The font list now has a **More fonts** group: Roboto, Open Sans, Lato, Montserrat, Poppins, Oswald, Merriweather, Lora, Playfair Display, Source Code Pro, Roboto Mono and Pacifico (regular / bold / italic where the family has them), in addition to Helvetica, Times and Courier. They are embedded in the PDF (files in `public/fonts`, licence OFL). The colour pickers now read the true colour from a high-resolution render of the clicked spot (ignores anti-aliasing and JPEG noise; a click on a thin line or letter takes the pixel under the cursor) and show hex, rgb, hsl and the nearest colour name from a ~5,000-name list (`public/vendor/colornames.json`). The box is painted with that exact value. Also fixed: words in the typed text were joined without spaces.
- **Cut / copy image (separate button next to Add image):** click **Cut / copy image**; every image on the pages gets a dashed outline. Click the one you want, then choose **Cut** (Ctrl+X) or **Copy** (Ctrl+C). Cut removes it from the page: the content below moves up and the first lines/pictures of the next page(s) flow up into the freed space (a last page that becomes empty is removed; a picture too tall for the free space stays on the next page). Copy leaves the original in place. Then click where it should go (any page) and use the same drag / resize / **Place image** steps as Add image. Esc or Cancel puts everything back; Ctrl+Z undoes each step. Works for real embedded pictures (screenshots, photos); vector drawings and text are not clickable as images. No AI needed. Add image itself is unchanged.
- **Word -> PDF (fit & fill):** convert a .docx to PDF in the original order; text and pictures are resized together so pages are filled with no blank gaps (see the section above).
- **A friendly assistant in the chat:** your message first goes to an assistant that talks like a friend and works out what you really want, using the chat so far, the text of the open PDF and the state of your report. It can chat, answer questions about the app or your PDF, ask one question when it is truly needed, tell you which button to click, or do the job: write a new PDF, edit the open one, open the Screenshot -> Report window, make or change a report, undo / redo. It tells you what it assumed instead of making you fill a form. Instant commands (`replace X with Y`, Delete on a selection, colour on a selection) still run locally without AI. If the assistant cannot be reached (no key, rate limit), the app falls back to the old direct behaviour. This adds one small AI call per message (about 1,000 tokens), so on the Groq Free plan (8,000 tokens/min) wait a few seconds between messages if you hit a rate limit.
- **Chat changes the finished report properly:** after a Screenshot -> Report is created, whatever you type (without text selected) is applied to the REPORT itself: "make the theory shorter", "add a Result section", "change the aim to ...", "move screenshot 3 to the start", "remove the last screenshot", "put Output after Observation". The AI gets the current report and changes only what you asked, then the app lays the pages out again (Ctrl+Z undoes it). Questions are answered in the chat without changing the PDF. `replace X with Y` still runs instantly, and if you select text or a region first, the message edits that selection directly. `redo <instructions>` now keeps your original request (experiment no., subject) and adds the new instructions.
- **Screenshots in a sensible order:** the AI reads every screenshot, then arranges them (setup, code from top to bottom using line numbers and file names, then outputs, then graphs). Untick "Let AI arrange" in the dialog to keep your own order. You can always reorder with the arrows, Sort A-Z or Sort by time.
- **Screenshots stacked one under another:** every screenshot goes full text width, in order, one below the other (no side-by-side tiles, no blank bars, never cropped). A screenshot that does not fit under the previous one is shrunk a little (down to 60% width) to fill the page, otherwise it starts the next page; one taller than a page is scaled to fit that page so all of it is visible. Each has a small "Fig. N" caption.
- **Add image is now resizable:** click where it should go, then drag it, drag the round corner handle or use the slider, and press "Place image". **The image now makes room for itself:** everything below it (text and images) moves down by the image height, so a blank slot is left and nothing is covered. Header, footer and border stay in place; if the moved content no longer fits above the footer, the extra lines continue at the top of a new page. Undo with Ctrl+Z.
- **Aim:** if you do not give one, or say "write the aim yourself", the AI writes it (a fallback request guarantees it is never empty).
- **New look:** refreshed toolbar, chat, dialogs and page area. All features and buttons are unchanged.
- **Home screen:** when no PDF is open you now get a welcome page with quick-start cards (Open PDF, Create with AI, Screenshot -> Report, Template + Results), clickable example prompts and a feature list. The New button brings it back.
- **Cleaner report text:** the AI no longer writes "Screenshot 0/1/2..." (it names files or says what the image shows, and any leftover is stripped), and Greek letters or special hyphens are written as words (delta, eta, -) instead of "?".
