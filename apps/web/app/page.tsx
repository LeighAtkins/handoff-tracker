import { redirect } from "next/navigation";

// The overview leads with what needs someone today, and links on to the stuck list.
export default function Home() {
  redirect("/overview");
}
