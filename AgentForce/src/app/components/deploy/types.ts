export interface ProfileOption {
  id: string;
  name: string;
  fullName: string;
  email: string;
  resumeFolderUrl: string;
  defaultModel: string;
  resumeStacks: string[];
}

export interface ModelOption { id: string }

export interface SourceOption { title: string; type: string; posted: number }
