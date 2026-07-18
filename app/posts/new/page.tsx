import CreatePostComposerClient from "../../redesign/CreatePostComposerClient";
import { getWorkspaceProps } from "../../redesign/workspace";

export default async function NewPostPage() {
  const workspace = await getWorkspaceProps();
  return <CreatePostComposerClient user={workspace.user} connectedAccounts={workspace.connectedAccounts} subscription={workspace.subscription} />;
}
