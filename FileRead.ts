const decoder = new TextDecoder('utf-8')

const data = await Deno.readFile("sample.txt")

console.log(decoder.decode(data))
// decoder 없이 await Deno.readTextFile('sample.txt')로 바로 할 수도 있음

const encoder = new TextEncoder()

const newText = 'hello again!'

await Deno.writeFile('sample.txt', encoder.encode(newText))

// await Deno.rename('sample.txt', 'othername.txt')
// await Deno.remove('sample.txt')
