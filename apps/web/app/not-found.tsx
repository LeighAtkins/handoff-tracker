import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-zinc-600">
        That shipment or page does not exist. It may have been removed by a re-import.
      </p>
      <Link href="/shipments" className="mt-4 inline-block underline">
        Back to shipments
      </Link>
    </div>
  );
}
