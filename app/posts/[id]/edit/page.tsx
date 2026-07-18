import CreatePostComposerClient from "../../../redesign/CreatePostComposerClient";
import { getWorkspaceProps } from "../../../redesign/workspace";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await getWorkspaceProps();
  const { id } = await params;
  return <CreatePostComposerClient user={workspace.user} connectedAccounts={workspace.connectedAccounts} subscription={workspace.subscription} initialPostId={id} />;
}
