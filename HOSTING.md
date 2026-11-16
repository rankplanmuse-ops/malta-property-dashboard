# Hosting: the two remaining manual steps

The app is finished and verified locally. It is not live yet because repo
creation on the rankplanmuse-ops GitHub account cannot be done from the
automation account (the GitHub App returns 403 on repo creation, and there
is no personal access token or gh CLI login on the VM). A human with the
account signed in does these two steps once:

## 1. Create the repo (about 1 minute)

1. Go to https://github.com/new while signed in as rankplanmuse-ops.
2. Repository name: `malta-property-dashboard`. Public. Do NOT add a
   README (the code push brings its own). Create repository.

## 2. Tell the assistant "repo created"

The assistant then pushes all files in this folder over the working git
SSH route, creates the `gh-pages` branch, and verifies
https://rankplanmuse-ops.github.io/malta-property-dashboard/ loads.
If the URL 404s after the push, one setting finishes it: repo Settings,
Pages, Build and deployment, Source: Deploy from a branch, Branch:
`gh-pages`, folder `/ (root)`, Save.

Alternative if GitHub is not wanted: connect Vercel (the account already
used for other projects) and import this folder as a static project with
no build command and output directory `.`; the resulting
`*.vercel.app` URL then replaces the GitHub Pages URL in SETUP.md step 4.
