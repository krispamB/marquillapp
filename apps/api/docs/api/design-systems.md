# Design Systems API

A Design System is the app-owned visual style a DOCUMENT artifact is generated
in. These endpoints list the systems a user may choose from and serve their
preview images. Both require authentication, and both use the default rate
limit.

There is no detail endpoint, and the list never returns a system's definition.

## List Design Systems

### `GET /api/v1/design-systems`

Returns the systems a user may select, the default (`margin`) first and the
rest ordered by `id`. The response is a bare array, not the `ApiResponse`
envelope.

```ts
type DesignSystemSummary = {
  id: string; // slug, e.g. "margin"
  version: number; // the ACTIVE version
  name: string;
  summary: string;
  previews: string[]; // API paths, in page order
};
```

```json
[
  {
    "id": "margin",
    "version": 1,
    "name": "Margin",
    "summary": "Quiet Swiss minimalism. One sans family, small type, a fixed baseline, and most of the page left empty.",
    "previews": [
      "/api/v1/design-systems/margin/1/previews/1.png",
      "/api/v1/design-systems/margin/1/previews/2.png"
    ]
  }
]
```

`previews` are paths on the API origin. Resolve them against the origin the
client already uses for `/api/v1` (on the web app, its own origin), and send
credentials as for any other route.

## Fetch a preview image

### `GET /api/v1/design-systems/:id/:version/previews/:n.png`

Returns page `n` (one-based) of the system's sample document, rendered at
540×675, as `image/png` with:

```
Cache-Control: public, max-age=31536000, immutable
```

The version is part of the path, so the URL changes whenever the images do.
Always use the paths from the list rather than building them.

Returns `404` when:

- `id` is not a selectable system;
- `version` is not that system's ACTIVE version, for example after a newer
  version replaces it;
- page `n` does not exist.
