import ComposerRedesignClient from "../../../redesign/ComposerClient";
import { getWorkspaceProps } from "../../../redesign/workspace";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await getWorkspaceProps();
  const { id } = await params;
  return <ComposerRedesignClient {...workspace} mode="edit" initialPostId={id} />;
}
