import { redirect } from "next/navigation";

// Stuck shipments are what staff come here for.
export default function Home() {
  redirect("/stuck");
}
