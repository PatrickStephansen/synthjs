# synthjs

Beginner-friendly modular synth for the browser. See it run at https://patrickstephansen.github.io/synthjs/.

Run `npx maid <level3-heading>` to run the listed scripts. (`npm i` first to make sure maid is installed)

This project is only meant to run in the latest Chromium browser. Experimental Web Platform features must be switched on at chrome://flags/ for full functionality.

It uses the following experimental features:

* MIDI API (Chrome only, but not behind experimental flag anymore) - useless without this

## scripts
<!-- maid-tasks -->

### serve

Start the webpack development server.

```bash
npm start
```

### bundle

Use webpack to create a deployable bundle.

```bash
npm run bundle
```

### deploy

Run task `bundle` before this. Deploy using Github pages.

```bash
npm run deploy
```
