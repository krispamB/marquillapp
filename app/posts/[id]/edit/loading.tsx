import { LoaderCircle } from "lucide-react";

export default function EditPostLoading() {
  return (
    <div className="mq-card mq-create-post-empty" aria-busy="true">
      <LoaderCircle className="mq-spin" size={24} />
      <h2>Loading post</h2>
      <p>Restoring the pinned artifact, media, and publishing details…</p>
    </div>
  );
}
