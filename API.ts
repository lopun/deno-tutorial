import {Application, Context} from "https://deno.land/x/abc@v1.2.1/mod.ts"

const app = new Application()

app.static('/', './public');

app.get("/", async (ctx: Context) => {
  await ctx.file("/public/index.html")
})

app.start({port: 3000})
