# Facilio Vision

Vibeathon 2026 project, built on the Facilio Vibe platform.

- **App:** `facilio-vision`
- **URL:** https://facilio-vision.vibe.facilio.com/
- **Org:** Facilio Vetri Kazhagam (#2915), region US

## Stack

React 18 + Vite, talking to Facilio through `@facilio/vibe-sdk`. The build output in
`dist/` is what gets zipped and shipped — `vibe.json` points at it.

```
├── vibe.json              # Vibe CLI config (app linkName + publish dir)
├── index.html
├── src/
│   ├── main.jsx
│   ├── App.jsx            # auth bootstrap + where the feature goes
│   ├── vibe.js            # createVibe() singleton
│   └── styles.css
└── .github/workflows/deploy.yml
```

## Quick start

```bash
npm install
facilio login          # must land on org #2915
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch/PR/release workflow and the
rules on discovering connection slugs.
