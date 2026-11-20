export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = new URL(request.url).origin

  return Response.json(
    {
      url: origin,
      name: "CyberNode",
      iconUrl: new URL("/cybernode-icon.svg", origin).href,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  )
}
