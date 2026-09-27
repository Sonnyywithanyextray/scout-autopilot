import { runScout } from '@/lib/run'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const result = await runScout(body.source === 'supabase' ? 'supabase' : 'seed')
  return Response.json(result)
}
