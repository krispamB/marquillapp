export interface postArtifact {
  title: string;
  content: string;
}

export interface pollArtifact {
  title: string;
  content: {
    question: string;
    options: string[];
  };
}

export type markArtifact = 'html' | 'text' | 'structured';
