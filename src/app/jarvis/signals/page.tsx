import { redirect } from "next/navigation";

// "What Jarvis noticed" and tasks are one list now.
export default function SignalsPage() {
  redirect("/jarvis/items");
}
