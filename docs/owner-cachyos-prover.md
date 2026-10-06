# Owner-local prover on CachyOS

Preparation checked on 5 October 2026. These commands were researched, not executed on the owner's computer. Run them only on the same machine as Chrome and Lace. No wallet recovery phrase or Guestlist recovery file is needed for Docker setup.

## Install and start Docker Engine

CachyOS uses distro-maintained Arch packages. Docker Desktop and a Docker account are unnecessary for this single-container route. The first command also proposes normal rolling-system updates: review the package/upgrade list before confirming. If you do not want those updates, stop instead of forcing dependencies or using `pacman -Sy docker`.

```sh
sudo pacman -Syu --needed docker
sudo systemctl start docker.service
sudo docker version
```

Require **Server 28.0.0 or newer** for the localhost-publishing fix. The daemon is privileged; `sudo` approval stays on your machine. Do not add your user to the root-equivalent `docker` group. This guide does not enable boot-time autostart. If a kernel update requires a reboot, save your work first.

[Arch Docker guide](https://wiki.archlinux.org/title/Docker), [CachyOS FAQ](https://wiki.cachyos.org/cachyos_basic/faq/), [Docker start guide](https://docs.docker.com/engine/daemon/start/), [localhost publishing warning](https://docs.docker.com/engine/network/port-publishing/).

## Start the matrix-pinned prover

```sh
sudo docker run -d --name guestlist-preview-prover -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v
```

This downloads the official image and initially fetches public proving parameters. It publishes port 6300 only on IPv4 loopback. Do not replace the mapping with bare `6300:6300`, use `--privileged`, expose the port remotely, or blindly change to `latest`. No Guestlist private file is mounted into the container. Later proofs send private witnesses to this service through Lace, so the computer and local service must remain trusted.

[Midnight local proving](https://docs.midnight.network/guides/local-proving), [Preview compatibility matrix](https://docs.midnight.network/relnotes/support-matrix).

## Read-only checks

```sh
curl -fsS http://127.0.0.1:6300/health
curl -fsS http://127.0.0.1:6300/version
curl -fsS http://127.0.0.1:6300/ready
```

Expect healthy/ready status and version 8.1.0. Initial parameter download may take time. A refused connection means no listener was reachable at that address; it does not identify whether installation, startup or the port is wrong. Preserve an exact error instead of changing firewall/VPN settings or funding the wallet again.

Stop/start this same container when needed:

```sh
sudo docker stop guestlist-preview-prover
sudo docker start guestlist-preview-prover
```

Before a browser reload/reboot, save the **nonsecret** account alias and public event ID from Guestlist section 1 locally. Keep the existing private recovery JSON on your machine. Reimport with its same role/alias/event; never create fresh authority to recover an unresolved operation. Do not send the file or any private values in chat. Once the local prover is verified, continue the separately reviewed [owner Preview steps](owner-testnet-setup.md). No deployment or transaction is implied by Docker or health checks.
