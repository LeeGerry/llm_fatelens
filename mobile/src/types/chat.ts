export type ChatMessage = {
  id: string;
  role: "user" | "master";
  text: string;
  mood?: string;
  audioUrl?: string | null;
  audioStatusUrl?: string | null;
  audioStatus?: "pending" | "ready" | "failed";
};
