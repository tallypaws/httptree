import { error, json, redirect, root, text } from "httptree";

const app = root();

app.use((req, res, next) => {
  console.log(`request: ${req.method} ${req.url} 1st`);
  next();
}, -1);

app.use((req, res, next) => {
  console.log(`request: ${req.method} ${req.url} 2nd`);
  next();
}, -1);

app.use((req, res, next) => {
  console.log(`request: ${req.method} ${req.url} 3rd`);
  next();
}, 1);

app.get("/hello/[[name]]", (req, res) => {
  return error.badRequest("bad request" + req.params.name, { "x-error": "true" });
});

await app.listen(3000);

console.log("listneing", 3000);

type Args<T> = T extends (...args: infer A) => any ? A : never;

// function debug({
//     stack = false,
//     args: logArgs = true,
//     returnValue = false,
//     timing = false
// } = {}) {
//     return (
//         value: Function,
//         context: ClassMethodDecoratorContext
//     ) => {
//         const original = value;
//         return function (this: any, ...args: Args<typeof original>) {
//             let start = 0;
//             if (timing) {
//                 start = performance.now();
//             }
//             if (logArgs) {
//                 console.log(`args for ${context.name.toString()}:`, args);
//             }
//             if (stack) {
//                 const stackTrace = "\n" + new Error().stack?.split('\n').slice(1).join('\n');
//                 console.log(`stack trace for ${context.name.toString()}:`, stackTrace);
//             }
//             const result = original.apply(this, args);
//             if (returnValue) {
//                 console.log(`${context.name.toString()} returned:`, result);
//             }
//             if (timing) {
//                 const end = performance.now();
//                 console.log(`execution time for ${context.name.toString()}: ${end - start}ms`);
//             }
//             return result;
//         }
//     }
// }

// class TestClass {
//     @debug({
//         stack: true,
//         args: true,
//         returnValue: true,
//         timing: true
//     })
//     method(arg: string) {
//         console.log("method called");
//     }
//     @debug()
//     private helper() {
//         console.log("helper called");
//     }

//     constructor() { this.helper() }
// }

// const testInstance = new TestClass();
// testInstance.method("electric boogaloo");
