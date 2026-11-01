Studytime - Deployment Instructions

To update or deploy this application to your existing GitHub Pages repository:

1. Extract this ZIP file. You will see a folder named `study_tracker_pwa`.
2. Open the `study_tracker_pwa` folder.
3. Select ALL the files inside this folder (index.html, app.js, styles.css, sw.js, manifest.webmanifest, icon.svg, README.txt).
4. Upload these files directly into the ROOT of your existing `studytime` GitHub repository.
   - Do NOT upload the ZIP file itself.
   - Do NOT upload the `study_tracker_pwa` folder as a whole folder. The files must sit at the top level of the repository (e.g. your repo should have `studytime/index.html` not `studytime/study_tracker_pwa/index.html`).
5. Commit the changes to your main branch.
6. GitHub Pages will automatically deploy the latest version to https://asialm07.github.io/studytime/

Data Persistence Note:
Since this application uses IndexedDB and localStorage, updating the static files on GitHub Pages will NOT delete your study history or settings. Your iPhone Safari will retain the data, update the service worker cache, and serve the new interface on the next visit.
