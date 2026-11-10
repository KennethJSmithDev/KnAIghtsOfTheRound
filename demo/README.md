# Round Table simulation

This is a self-contained, interactive simulation of two synthetic KotR evidence
reviews. Choose a case, run its recorded outcome, and inspect the Book of
Receipts or dashboard. The source-mismatch case withholds the selection.

The simulation makes no IRIS connection, model call, audit record, approval, or
task change. Its displayed audit numbers belong to an earlier recorded fixture;
they are not newly created records. The illustration is a lightweight original
SVG and does not contain the separately licensed detailed character model.

To review locally from this directory, run:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/` on the same computer and stop the server when
finished. The files use relative URLs and can also be served under a project
subpath. Preparing this directory does not publish or enable GitHub Pages.

For a phone on the same trusted local network, an operator can instead bind the
server to the computer's LAN interface, for example:

```sh
python -m http.server 4173 --bind 0.0.0.0 --directory .
```

Run that command from this `demo` directory, then visit
`http://<computer-LAN-address>:4173/` on the phone. It serves this directory to
devices that can reach the port; use the private network firewall setting and
stop it after the test. This does not create a public Pages deployment.

The page uses no WebGL canvas, external libraries, external network calls, or
continuous animation. Phone-sized Chromium and WebKit emulations checked the
interactive cases and layout; actual phone performance, battery use, and device
temperature still require measurements on the target devices.

For a comparable device pass, note the phone, browser version, power/charging
state, ambient conditions, and starting temperature or thermal warning. Check
cold load, both cases, the Book and dashboard, then a short idle period. Record
downloaded bytes, responsiveness, battery change, and temperature where the
device provides them. Compare the same sequence and conditions with the detailed
viewer separately; stop if a phone becomes uncomfortably hot.
