export function ok<T>(data: T, revalidate = 300) {
  return Response.json(
    { data },
    {
      status: 200,
      headers: {
        'Cache-Control': `s-maxage=${revalidate}, stale-while-revalidate`,
      },
    }
  );
}

export function err(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}
