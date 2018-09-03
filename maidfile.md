# synthjs

Beginner-friendly modular synth for the browser

Run `npx maid <level2-heading>` to run the listed scripts. (`npm i` first to make sure maid is installed)

This project is only meant to run in the latest Chromium browser. Experimental Web Platform features must be switched on at chrome://flags/ for full functionality.

It uses the following experimental features:

* MIDI API (Chrome only, but not behind experimental flag anymore) - useless without this
* Audio worklet API (Chrome only, but not behind experimental flag anymore) - useless without this - best way to add custom audio nodes (none yet)
* Canvas hit regions - allow changing parameters - also available in Firefox behind canvas.hitregions.enabled flag in about:config

## serve

Start the webpack development server.

```bash
npm start
```

## bundle

Use webpack to create a deployable bundle.

```bash
npm run bundle
```
