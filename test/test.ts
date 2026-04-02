import { error, json, redirect, root, text } from "httptree";

const app = root();

// app.use((req, res) => {
//   console.log(`request: ${req.method} ${req.url} 1st`);
// }, -1);

// app.use((req, res) => {
//   console.log(`request: ${req.method} ${req.url} 2nd`);
//   console.log(req.data);
// }, -1);

// app.use((req, res) => {
//   console.log(`request: ${req.method} ${req.url} 3rd`);
//   req.data.test = "test";
// }, 1);

app.get("/hello/[[name]]", (req, res) => {
  return error.badRequest("bad request" + req.params.name, {
    "x-error": "true",
  });
});

// // middleware before (not sigma, annoying, manual)

// app.use((req, res, next) => {
//   console.log(req, res);
//   next();
// });

// app.use((req, res, next) => {
//   res.end("early response");
// });

// // middleware now (sigma, takes estrogen, automatic, easy to use, so ohio fr)

// app.use((req) => {
//   console.log(req);
// }); // runs next one automatically

// app.use((req) => {
//   console.log(req);
//   return text("early response"); // creates a response and ends the chain
// });

// app.use((req, res, getNext) => {
//     // if you for some ungodly reason want to run the next one manually you can do this
//     const next = getNext();
//     console.log(req);
//     next(); // if you dont run this the chain stops :smile:
// });

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const startStamp = Date.now();
const secondsSinceStart = () => ((Date.now() - startStamp) / 1000).toFixed(2);

app.use(() => {
  console.log("before delay");
  console.log(`seconds since start: ${secondsSinceStart()}`);
});

app.use(async () => {
  await delay(1000);
});

app.use(() => {
  console.log("after delay");
  console.log(`seconds since start: ${secondsSinceStart()}`);
});

// no fukin clue why you would do this

app.use((req, res, getNext) => {
  const next = getNext();
  (async () => {
    // pretend async stuff
    next();
  })();
  // this part runs so this middleware is technically over
  // calling getNext() tells the router to NOT automatically run the next one
  // but if you call getNext() after the router already started the next one well good luck buddy
});

// basically dont do this

app.use((req, res, getNext) => {
  (async () => {
    const next = getNext();
    // pretend async stuff
    next();
  })();
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
