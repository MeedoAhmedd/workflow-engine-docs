# Mini Workflow Engine — Documentation

Public documentation site for the mini workflow engine, published via
GitHub Pages.

**Live site:** https://meedoahmedd.github.io/workflow-engine-docs/

## What this repo contains

Only the documentation site — a static HTML page in `docs/` plus the
two small standalone JavaScript engines it uses (a text-to-speech
read-aloud engine and a local Q&A chat widget called Arthur). No
application source code is here.

## Source code

The actual Spring Boot backend is in a **private** repository. Email
**mohamedahmedmaxx1@gmail.com** to request access — see the "Let's
Connect" section at the bottom of the docs site.

## Structure

```
workflow-engine-docs/
└── docs/                        published by GitHub Pages
    ├── index.html                the documentation site itself
    ├── read-aloud-engine.js      text-to-speech engine (standalone project)
    ├── read-aloud-voice-picker.js
    ├── arthur.js                 local Q&A chat engine (standalone project)
    ├── arthur-widget.js
    └── arthur-widget.css
```

## Author

Mohamed Ahmed ([@MeedoAhmedd](https://github.com/MeedoAhmedd))
