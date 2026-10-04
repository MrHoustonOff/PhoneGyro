# Certificates and TLS

Browsers hand out gyroscope data only over a secure `https://` connection. So PhoneGyro issues its
own certificate: the phone talks to the PC over HTTPS, with no internet and no third-party servers.
This page covers everything about those certificates: when you have to install them again, where
they live, how to remove them and how they work inside.

---

## In short

### When you have to install the certificate on the iPhone again

| Case | Why |
|---|---|
| First connection of an iPhone to this PC | The phone does not know this PC's certificate yet. |
| **Once, after updating to the version with name constraints** (the first one after 2.0.x) | The old PhoneGyro certificate was good for any site; the new one only for the local network (details below). The old one is replaced by itself on the first start. |
| You deleted `%APPDATA%\PhoneGyro` (or just `ca` inside it) | The certificate went with it; a new one is made on the next start. |
| Another PC, a Windows reinstall, another Windows account | Every account on every PC has its own certificate. |
| The certificate files are damaged | PhoneGyro makes a new one by itself; the log says `certificate: new root CA`. |
| Less than 30 days of validity left (it is issued for 10 years) | Replaced with a new one at start. |

After reinstalling, do not skip the second step: **Settings → General → About → Certificate Trust
Settings**, switch on the new certificate. Without it the profile is installed but Safari does not
trust it.

### When you do NOT

* You moved or renamed `PhoneGyro.exe`, or put it on another drive.
* You updated PhoneGyro (downloaded a new `PhoneGyro.exe`).
* The PC's IP changed (the router gave it another one, you joined another Wi‑Fi, you use the phone's hotspot).
* You changed the ports in the settings.
* You restarted PhoneGyro or the PC.

> [!IMPORTANT]
> **Moved the exe and the phone stopped connecting? It is most likely the firewall, not the certificate.**
> The certificate lives in the data folder and does not depend on where `PhoneGyro.exe` is. The Windows
> Firewall permission, however, belongs to the file's path: for `PhoneGyro.exe` in a new folder Windows
> asks again (or blocks silently if "Cancel" was pressed before). The sign: Safari loads for a long time
> and times out although the certificate is in place. See "The phone cannot connect: Windows Firewall"
> in the docs ([Troubleshooting](troubleshooting.en.md#the-phone-cannot-connect-windows-firewall)).

### Android

On Android nothing is installed. Chrome shows "Your connection is not private", you tap **Advanced →
Proceed**. Chrome remembers that decision for one particular server certificate. PhoneGyro keeps that
certificate and issues a new one only when the PC gets a new address, so the warning comes back:

* after the PC's IP changes (that is a new address for the browser anyway);
* when the PC gets a new network adapter with a local address (a VPN or a hotspot switched on);
* after the cases in the table above, when the root certificate is made anew;
* when Chrome forgets the decision by itself (it keeps it for a limited time, usually about a week).

---

## Where the files are

Folder: `%APPDATA%\PhoneGyro\ca` (usually `C:\Users\<name>\AppData\Roaming\PhoneGyro\ca`). PhoneGyro
opens it for you: **Settings → Behavior & notifications → Data folder → Open folder**, then `ca`.

| File | What it is | Secret? |
|---|---|---|
| `ca.crt` | The root certificate ("PhoneGyro Root CA (PC name)"). This is what the iPhone installs. | No |
| `ca.key` | The root certificate's private key. | **Yes.** Never send it to anyone. |
| `leaf.crt` | The server certificate PhoneGyro shows the phone. | No |
| `leaf.key` | The server certificate's key. | Yes |

PhoneGyro installs nothing into the Windows certificate store: the PC itself does not trust this
certificate, only the phone needs it.

## How to remove it

### From the PC

1. Quit PhoneGyro (including the tray).
2. Delete `%APPDATA%\PhoneGyro\ca`.

On the next start PhoneGyro makes a new certificate, and the iPhone has to install it again. To remove
PhoneGyro entirely, delete the whole `%APPDATA%\PhoneGyro` folder and `PhoneGyro.exe` itself.

### From an iPhone / iPad

1. **Settings → General → VPN & Device Management.**
2. Open the profile **PhoneGyro Root CA (PC name)**. Older versions named it **PhoneGyro Controller
   Profile**.
3. **Remove Profile**, confirm with the passcode.

Removing the profile removes the trust as well. If you installed certificates from several PCs or
several times, remove every PhoneGyro profile you no longer need.

### From Android

Nothing was installed on the phone. To make Chrome forget "proceed": **Chrome → ⋮ → Settings →
Privacy and security → Delete browsing data** (or wait until it forgets by itself).

---

## How it works (in detail)

### Two parts

1. **The root certificate (CA)**: `ca.crt` + `ca.key`. Made once, on the first start: ECDSA P‑384,
   valid for 10 years, named `PhoneGyro Root CA (PC name)`, may sign server certificates only
   (`MaxPathLen = 1`). This is what the iPhone trusts.
2. **The server certificate (leaf)**: `leaf.crt` + `leaf.key`. PhoneGyro shows it to the phone on every
   connection. ECDSA P‑384, valid for 365 days (Apple rejects server certificates valid for more than
   398 days), for servers only (`serverAuth`). It lists all of the PC's local IPv4 addresses and the
   names `localhost`, `gamepad.local`, and is signed by the root.

The server certificate is issued again when the PC has an address it does not list, or when less than
30 days of validity are left. This happens silently and needs nothing on the iPhone: the phone trusts
the root, and so everything the root signed.

### Name constraints: what they give and why a reinstall was needed

The old PhoneGyro root was good for **any** address. Whoever got hold of your `ca.key` (malware on the
PC, a data folder sent to someone) could issue a certificate for any site, a bank or a mailbox, that
your iPhone would accept, and read the traffic whenever the phone is on their network.

The root now carries X.509 Name Constraints. It signs only:

* local IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (phone hotspots,
  CGNAT, Tailscale), `169.254.0.0/16`, `127.0.0.0/8`;
* local IPv6: `fc00::/7`, `fe80::/10`, `::1`;
* the names `localhost` and `*.local`.

A certificate for `apple.com`, `google.com` or a public IP can no longer be made with this key: the
phone rejects it. The constraint lives inside the certificate already installed on the iPhone, so it
could not be added to the old one; a new one was needed, hence the one-time reinstall.

A consequence: if the phone can reach the PC only over a "public" address (a VPN like Radmin on
`26.x.x.x` or Hamachi on `25.x.x.x`), it cannot connect over that address. PhoneGyro leaves such
addresses out of the server certificate. Otherwise the phone would reject the whole certificate,
including for the ordinary home address.

### How the certificate gets onto the iPhone

The first QR code leads to `http://<PC IP>:8080/ca.mobileconfig` (the HTTP port from the settings). It
is an iOS profile holding only `ca.crt`, without the key. Its identifier contains the certificate's
fingerprint (`com.phonegyro.ca.<first 8 bytes of SHA‑256>`), so certificates of different PCs install
side by side instead of replacing each other. The same certificate as a plain file is at `/ca.crt`.

The profile comes over plain `http://`. That is fine: it holds no secrets. Only someone on your network
at the moment of installing could swap it, and iOS shows the certificate's name and asks you to
confirm both the install and the trust by hand anyway.

### When the root certificate is made anew by itself

At start PhoneGyro checks `ca.crt` and `ca.key` and makes a new pair if:

* a file cannot be read or is damaged;
* the key does not match the certificate;
* the certificate has no name constraints (made by an older version);
* less than 30 days of validity are left.

The reason goes to the log `%APPDATA%\PhoneGyro\logs\phonegyro.log` as
`certificate: new root CA (…)`. The old files are overwritten.

### If `ca.key` leaked anyway

An attacker could pretend to be PhoneGyro on your local network, but not any other site. To close that
too: remove the profile from the iPhone, delete the `ca` folder on the PC, start PhoneGyro and install
the new certificate.
