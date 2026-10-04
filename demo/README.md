# Kobe.ai demo video

Renders a 30-second demo of the public app to `out/kobe-demo.mp4` (gitignored).

```bash
npm ci
python3 -m pip install -r requirements.txt   # numpy, for the soundtrack
node record.mjs --check    # loads the page and exits; proves the guards below
node record.mjs --preview  # one still every 0.5s, about a minute
bash build.sh              # full 1080p render, about 8 minutes
```

Chrome is discovered automatically. Override it with `CHROME=/path/to/google-chrome`.

## What it records

The default URL is https://kobeai.vercel.app/ (`KOBE_URL` overrides it). That deployment serves the current Next.js UI as the locked offline demo: the scripted agent runs in the browser, and the on-screen URL in the outro is `kobeai.vercel.app`.

A run refuses to start unless the page says `OFFLINE DEMO` and shows the game plan and composer. It also aborts every `/api/` request inside the browser, before it is sent, and fails the run if the page tried to make one. That keeps a recording from calling a model or writing a draft to a database, including if the deployment later turns the live agent on.
