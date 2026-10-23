# PeerPort Privacy Guarantees

PeerPort is engineered with a strict **Privacy-First** posture:

1. **No Cloud Payload Storage**: PeerPort has zero cloud storage. No Amazon S3, Google Cloud Storage, or temporary databases are ever used to hold transferred files.
2. **No Tracking or Telemetry**: No Google Analytics, Mixpanel, or third-party advertising SDKs are included.
3. **No Persistent Device Fingerprints**: Sessions use ephemeral identifiers that are destroyed upon disconnection.
4. **No Directory Browsing**: Neither peer can explore the other's file system. Only explicitly selected files are visible in the offer manifest.
5. **Clear Network Transparency**: When an internet-assisted relay is in use, PeerPort explicitly alerts the user with a distinct badge.
6. **Instant Clean-up**: On session completion, all temporary object URLs, cryptographic keys, and connection instances are revoked and garbage-collected.

