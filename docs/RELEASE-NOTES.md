# Download Reference Align

**Already know Onshape? You do not need to know web development.** Download one
ZIP below. Everything needed to run the app is included; no programming tools
or separate runtime installation required.

## 1. Pick your computer

| Your computer | Download |
| --- | --- |
| Windows PC with an Intel or AMD processor | [Download for Windows](https://github.com/thereprocase/onshape-reference-align/releases/download/__RELEASE_TAG__/reference-align-windows-x64.zip) |
| Mac with an Apple chip (M1, M2, M3, M4, or later) | [Download for Apple-chip Macs](https://github.com/thereprocase/onshape-reference-align/releases/download/__RELEASE_TAG__/reference-align-macos-arm64.zip) |
| Mac with an Intel processor | [Download for Intel Macs](https://github.com/thereprocase/onshape-reference-align/releases/download/__RELEASE_TAG__/reference-align-macos-x64.zip) |
| Linux PC with an Intel or AMD 64-bit processor | [Download for Linux](https://github.com/thereprocase/onshape-reference-align/releases/download/__RELEASE_TAG__/reference-align-linux-x64.zip) |

**Not sure which Mac?** Open the Apple menu → **About This Mac**. “Chip: Apple…”
means the Apple-chip download. “Processor: Intel…” means the Intel download.
These packages are for desktop computers, not Android, iPhone or iPad.
There is no native Windows ARM or Linux ARM package.

## 2. Unzip it, then start it

1. Find the ZIP in your **Downloads** folder.
2. **Windows:** right-click → **Extract All**. **Mac:** double-click the ZIP.
   **Linux:** use your file manager's **Extract** action. Open the extracted folder.
3. Open **START-HERE.html** for the step-by-step setup guide. Keep every file together.
4. Start the app using the file for your computer:
   - **Windows:** double-click **START-REFERENCE-ALIGN.cmd** (the `.cmd` ending may be hidden).
   - **Mac:** double-click **START-REFERENCE-ALIGN.command**.
   - **Linux:** open **START-REFERENCE-ALIGN.sh** and choose **Run** if asked.
     If your file manager only opens it as text, follow the Linux steps in the guide.
5. The app opens in your web browser. Keep the app's other window open while you work.
   If the browser does not open, copy the local address printed in that window.

Do **not** download GitHub's “Source code” archives below. Those are for developers,
not the ready-to-run app. You do not need to clone this repository or install Node.

## 3. Connect to Onshape

The app's connection wizard explains how to create and enter your own Onshape API
key. Treat that key like a password: never post it in an issue or screenshot.
Then paste your Part Studio link, choose an image and follow the preview/apply steps.
You can try local image previews before connecting your account.

[Read the setup guide online](https://thereprocase.github.io/onshape-reference-align/START-HERE.html)
· [Get help / report a problem](https://github.com/thereprocase/onshape-reference-align/issues/new/choose)

## If Windows or macOS warns you

These downloads do not have a paid publisher signature or Apple notarization.
A first-launch warning is possible. Only open a download you trust; follow the
guide's instructions for allowing this specific app. **Do not disable antivirus
or system security.** If your computer is managed by work or school, ask its
administrator when opening is blocked.

<details>
<summary>Testing, limitations and checksums (technical details)</summary>

The release workflow requires automated tests, executable builds and local-stub
app checks on Windows, Linux and both Mac architectures before publishing.
These checks do not replace a real person's first-launch test or prove that every
desktop security prompt has been tested.

Image placement uses the included custom Onshape feature. Calibrating an existing
native Onshape “Insert image” entity is not supported.

The **SHA256SUMS** asset is for optional download-integrity verification; you do not
need to open it to run the app. See the setup guide and distribution documentation
for verification instructions. Source and third-party licenses are included.

</details>
