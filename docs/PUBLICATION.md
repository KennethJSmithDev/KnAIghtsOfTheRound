# Contest publication checklist

The organizer stated a submission deadline of November 8, 2026 at 11:59 PM EST. Check the actual entry's acknowledgment and current organizer controls separately from repository maintenance. Open Exchange submission and public IPM registry activation are maintainer actions.

## Prepare the listing

- Use the canonical repository, https://github.com/KennethJSmithDev/KnAIghtsOfTheRound.
- Record the intended source commit with `git rev-parse HEAD` and confirm its public README describes that source.
- Use `assets/brand/kotr-logo.png` as the supplied project artwork.
- Link the [judge walkthrough](JUDGE-WALKTHROUGH.md), [installation guide](INTEROPERABILITY.md), and [synthetic task guide](SYNTHETIC-TASK.md).
- Describe the native AI Hub and optional authenticated Codex MCP workflows at their qualified scopes. The Round Table, procedural graphics and local interfaces are implemented optional source profiles; distinguish them from recorded replay, the static simulation and future distribution work.
- State the supported Build 154 image and existing local `gpt-oss:20b` requirement. Other runtime builds and broad concurrency/load behavior remain unqualified; the bounded two-worker duplicate-effect check passed.

## Submit through Open Exchange

In the Developer portal, choose **All applications → New Application** and supply the repository URL. Review the imported description, license, supported products, installation instructions and documentation links. Preview the listing before sending it for approval.

Select **Publish in Package manager** to request publication to the public IPM registry. Open Exchange is the public registry's publication path. A GitHub push alone does not activate the registry package. The manifest version is currently `0.1.0`.

The manifest explicitly includes `NOTICE` in standard IPM packaging. The package builder also includes `LICENSE` and `NOTICE` in its exact-source archive. Verify those files in the actual registry-produced artifact after publication, since the registry builds its own representation.

Send the application for approval, then apply it to **Contest 49**. Open Exchange review and contest registration are separate steps. [Official application submission](https://docs.openexchange.intersystems.com/apps/submit/), [public IPM publication](https://docs.openexchange.intersystems.com/apps/ipm/), and [Contest 49](https://openexchange.intersystems.com/contest/49) provide the current controls.

## Verify after registry activation

Confirm the published package name and version, inspect its actual source and licensing inventory, and exercise installation in a fresh owned Build 154 namespace. Match the installed classes to the intended source and check the synthetic decisions and audit records. Record the downloaded artifact hash rather than assuming it equals a locally generated TGZ.

Retain the previously qualified artifacts and records. Further publication, interface integration and runtime qualification should each identify their own source commit and result.
