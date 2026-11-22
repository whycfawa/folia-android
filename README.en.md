<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

<div align="center">
<a href="https://trendshift.io/repositories/71740?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-71740" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/71740" alt="chthollyphile%2Ffolia-major | Trendshift" width="250" height="55"/></a>

# Folia for Android

Lyrics Reimagined // 辞曲新境

[简体中文](README.md) | English

[![GitHub release](https://img.shields.io/github/v/release/chthollyphile/folia-major?label=release)](https://github.com/whycfawa/folia-android/releases)
[![GitHub stars](https://img.shields.io/github/stars/chthollyphile/folia-major?style=social)](https://github.com/whycfawa/folia-android/stargazers)
[![All Contributors](https://img.shields.io/badge/all_contributors-35-orange.svg?style=flat-square)](CONTRIBUTORS.md)

[User Guide](https://folia-site.cielaniska.top/guide/)
·
[Technical Notes](docs/technical.md)

</div>

> [!IMPORTANT]
> **This repository is an unofficial Android port of Folia and is not affiliated with the upstream author.**
>
> - Upstream project: [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)
> - This repository is an Android port and maintenance fork of the upstream project, with a Capacitor Android container, platform bridge, background playback, lock-screen media controls, local music, and other Android features.
> - This repository remains licensed under the upstream project's **AGPL-3.0** license. Third-party components and notices are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## About

Folia is an online music player built around full-screen, immersive lyrics. It supports NetEase Cloud Music, Kugou, QQ Music, Navidrome, and local music libraries; the desktop app also supports Bodian Music, YouTube Music, Spotify, and Qishui Music. Smart lyric matching, AI-generated color themes, and a range of full-screen lyric animations make listening feel different.

## Quick download

> [!TIP]
> - **GitHub**: [Latest Release](https://github.com/whycfawa/folia-android/releases)

## Showcase

![visualizer](./img/visualizer.png)

### Try it online (community build)

Try Folia in your browser: [folia-ce.cn](https://folia-ce.cn/)

> [!NOTE]
> This is a community-hosted demo, for trying Folia out only. It is deployed from [folia-ce/folia-web](https://github.com/folia-ce/folia-web) and includes the community author's own changes, so it is not identical to the official web version. Please report any issues to that community repository. For everyday use, download the desktop app or deploy your own instance.

### Selected styles

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Luminous preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Fume</strong></td>
    <td align="center"><strong>Luminous</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Mindscape preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Partita preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Mindscape</strong></td>
    <td align="center"><strong>Partita</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="Cappella preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Cappella</strong></td>
    <td align="center"><strong>Tilt</strong></td>
  </tr>
    <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="Diorama preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="Pendolo preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Diorama</strong></td>
    <td align="center"><strong>Pendolo</strong></td>
  </tr>
</table>

Each lyric animation has its own typography, mood, and tunable parameters, giving full-screen lyrics the richness of a lyric video while staying responsive to any window size.

## Features

| Feature | Description |
| --- | --- |
| Online search and playback | Search for songs, artists, or albums and play them; covers and lyrics load automatically. |
| Local music | Import local audio files. Folia stores the index locally and never uploads file contents. See [Local Library Management](docs/local-library-management.md) (Chinese). |
| Smart lyric matching | Local songs are matched to online lyrics and covers automatically; you can correct matches by hand. |
| Local lyric files | Loads `.lrc`, `.vtt`, `.ttml`, `.qrc`, `.yrc`, and `.krc` files with the same name in the same folder, as well as embedded LRC lyrics. Supports the enhanced word-by-word formats produced by LDDC. |
| Now Playing integration | Connects to a local [Now Playing](https://github.com/Widdit/now-playing-service/) service to take song, timeline, and lyric data from external players and drive Folia's stage view and full-screen lyrics. |
| AI themes | Generates immersive backgrounds and visual parameters from a song's mood and lyrics. |
| Multi-platform | Provides a web deployment option and supports packaged desktop distribution. |
| Mods (experimental) | Folium mods can add lyric animations, backgrounds, player-page layers, commands, and more, and can install officially verified mods from the [mod market](https://folium-compound.cielaniska.top). See [Mods](#mods-folium-v1x). |

## Get Folia

The desktop app bundles both frontend and backend, so it works right after install.

## Mods (Folium v1.x)

> [!NOTE]
> Mods are experimental. Node-based mods are not available on mobile. They are off by default; turn them on in **Settings → Mods → Mod system**.

Folium is Folia's mod platform. Mods can add lyric animation modes and background types, overlay content on the player page, add buttons and markers to the progress bar, register commands and settings sections, rewrite lyrics before they are displayed, and use native capabilities such as ffmpeg through a Node entry point. Mods run as trusted code: you confirm each mod in a native window before it is enabled, and confirm again after its files change.

- **Mod market**: [folium-compound.cielaniska.top](https://folium-compound.cielaniska.top) hosts official mods and reviewed community mods. Download the zip and drag it into the Mods panel to install.
- **Verification**: Every mod in the market carries a Folium signature and shows as **Verified** after install. Early-access mods that passed only the security review show as **Preview**. Third-party mods without a signature show as **Unverified** and still work.
- **Developing and contributing**: The [mod development and contribution guide](docs/folium/contributing.md) walks from your first mod and local debugging through submitting to the market, review and signing, and publishing updates.
- **API reference**: The [Folium API reference](docs/folium/api.md) is generated from the contract file and organized by registries, contexts, events, and services.
- **Platform spec**: The [Folium spec](mods/README.md) covers manifest fields, permissions, registry semantics, events, the security model, and versioning.
- **Example mods**: The repository's [`mods/`](mods/) folder covers lyric animations, tuning, the progress bar, player-page layers, and transparent video export.

## Sync Server

Folia offers an optional official sync server, `sync-server`, that syncs appearance settings and the AI theme library across devices. You host it yourself; it suits anyone who wants their color themes on every device.

Deployment options:

- **Cloudflare Workers / D1**: Serverless, no servers to maintain. Recommended.
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**: See the [Docker deployment folder](deploy/docker/README.md) for the image and Compose setup.
- **Self-hosted Node.js**: Uses SQLite; suits local machines or environments where Docker is inconvenient.

For environment variables, token setup, and deployment steps, see the [Sync Server deployment guide](https://folia-site.cielaniska.top/guide/deploy-sync). Once deployed, enter the server URL and `SYNC_TOKEN` in **Settings → Connections** to turn on sync.

## Local music and matching

Folia reads audio metadata plus lyrics and covers from the same folder, and can fill in song details from NetEase Cloud Music, QQ Music, or Kugou. Automatic matching tries NetEase, then QQ, then Kugou. When a match is wrong, you can pick another candidate, restore the local data from the first import, or merge and split artist and album entries.

For importing, rescanning, matching, entry editing, playlists, caching, and troubleshooting, see [Local Library Management](docs/local-library-management.md) (Chinese).

## Contributors

Thanks to everyone who has filed issues, reported bugs, suggested ideas, tested, or written code. Contributions are tracked under the all-contributors specification.

The list is long, so see [Contributors](CONTRIBUTORS.md).

## Legal and disclaimer

This project was developed with extensive AI assistance and may still contain subtle or hard-to-spot problems. We apologize for any inconvenience.

The project mainly showcases playback animation, interface design, and the engineering behind them. Copyright in the online streams, lyrics, album art, and other content shown in the app belongs to the respective rights holders.

This repository and its source code are for personal study, technical exchange, and non-profit testing only. Do not use them for commercial purposes. Users bear sole responsibility for any copyright dispute or other liability arising from distributing, modifying, or redistributing online resources; the developers accept no liability.

Please respect digital rights and support licensed music through official platforms whenever you can.

## Acknowledgements

Special thanks to these projects and resources:

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
- [paper-design/shaders](https://github.com/paper-design/shaders)
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)

Folia uses the [Apple Music-like Lyrics TTML word-by-word lyrics database](https://github.com/amll-dev/amll-ttml-db) for high-quality lyric files. Thanks to its authors and contributors.

## License

Folia is open source under the `AGPL-3.0` license.
