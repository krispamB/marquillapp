# Users and preferences

## `GET /users/me`

Returns the authenticated user's profile. The response includes `preferences` once the user has saved one; a missing object or field means the user has not chosen a value.

```json
{
  "_id": "6650...",
  "name": "Ada Obi",
  "email": "ada@example.com",
  "tier": "6650...",
  "preferences": { "theme": "dark", "timezone": "Africa/Lagos" }
}
```

## `PATCH /users/me/preferences`

Saves preferences that follow the user across devices. Send only the fields you are changing; a field you leave out is kept.

| Field      | Type                              | Meaning                                                                                  |
| ---------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `theme`    | `"system"` \| `"light"` \| `"dark"` | `system` follows the device's colour scheme.                                              |
| `timezone` | IANA name \| `null`               | For example `"Europe/London"`. `null` clears it, so the client uses the browser's timezone. |

```json
{ "theme": "light", "timezone": null }
```

The response is the resolved preferences, with defaults filled in:

```json
{ "theme": "light", "timezone": null }
```

An unknown theme or a timezone that is not an IANA name returns `400`.

The timezone is stored for the user; scheduling still sends the timezone of the browser that picks the time.
