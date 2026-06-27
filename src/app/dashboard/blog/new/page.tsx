import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { PostForm } from "@/components/dashboard/PostForm";
import { createPost } from "@/app/dashboard/blog/actions";

export default async function NewPostPage() {
  await verifySession();

  return (
    <div>
      <Link href="/dashboard/blog" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Back to blog
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">
        New post
      </h1>
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8">
        <PostForm action={createPost} submitLabel="Create post" />
      </div>
    </div>
  );
}
