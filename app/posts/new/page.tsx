import CreatePostComposerClient from "../../redesign/CreatePostComposerClient";
import {
  createInitialPostComposerData,
  pinnedArtifactReferenceFromPost,
} from "../../redesign/postComposer";
import { getWorkspaceProps } from "../../redesign/workspace";
import {
  getArtifactDetail,
  getPostDetail,
  getServerAuth,
} from "../../lib/session";

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const [workspace, query] = await Promise.all([
    getWorkspaceProps(),
    searchParams,
  ]);
  const draftParam = Array.isArray(query.draft) ? query.draft[0] : query.draft;

  if (draftParam === undefined) {
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
      />
    );
  }

  const draftId = draftParam.trim();
  if (!draftId) {
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
        initialLoadError="Unable to load this post."
      />
    );
  }

  try {
    const serverAuth = await getServerAuth();
    const postResponse = await getPostDetail(serverAuth, draftId);
    if (!postResponse.data) throw new Error("The saved post was unavailable.");
    const artifactReference = pinnedArtifactReferenceFromPost(postResponse.data);
    const artifactResponse = await getArtifactDetail(
      serverAuth,
      artifactReference.artifactId,
      artifactReference.version,
    );
    if (!artifactResponse.data) throw new Error("The pinned artifact was unavailable.");
    const initialPost = createInitialPostComposerData(
      postResponse.data,
      artifactResponse.data,
    );
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
        initialPost={initialPost}
      />
    );
  } catch {
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
        initialLoadError="Unable to load this post."
      />
    );
  }
}
