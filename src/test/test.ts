import { error, json, redirect, root } from "../index.js";

const app = root()

app.get("/", (req, res) => {
    throw new Error("TestError");
});

app.post("/post", (req, res) => {
    throw new Error("PostError");
});

app.delete("/del", (req, res) => {
    throw new Error("DeleteError");
});

app.get("/hello", (req, res) => {
    return json({ message: "Hello, World!" });
});



// app.handleError("NotFound", (err, req, res) => {
//     res.statusCode = 404;
//     res.end("Custom Not Found: " + err.message);
// });

app.handleError("InternalError", (err, req, res) => {
    res.statusCode = 500;
    res.end("Custom Internal Error: " + err.message);
});


const testBranch = app.branch("/test");


testBranch.get("/branch/[beans]/[...a]/", (req, res) => {
    return json({ message: "Hello from branch! ", params: req.params });
});

testBranch.handleError("NotFound", (err, req, res) => {
    res.statusCode = 404;
    res.end("Branch Not Found: " + err.message);
});

await app.listen(3000);

type Args<T> = T extends (...args: infer A) => any ? A : never;

function debug({
    stack = false,
    args: logArgs = true,
    returnValue = false,
    timing = false
} = {}) {
    return (
        value: Function,
        context: ClassMethodDecoratorContext
    ) => {
        const original = value;
        return function (this: any, ...args: Args<typeof original>) {
            let start = 0;
            if (timing) {
                start = performance.now();
            }
            if (logArgs) {
                console.log(`args for ${context.name.toString()}:`, args);
            }
            if (stack) {
                const stackTrace = "\n" + new Error().stack?.split('\n').slice(1).join('\n');
                console.log(`stack trace for ${context.name.toString()}:`, stackTrace);
            }
            const result = original.apply(this, args);
            if (returnValue) {
                console.log(`${context.name.toString()} returned:`, result);
            }
            if (timing) {
                const end = performance.now();
                console.log(`execution time for ${context.name.toString()}: ${end - start}ms`);
            }
            return result;
        }
    }
}

class TestClass {
    @debug({
        stack: true,
        args: true,
        returnValue: true,
        timing: true
    })
    method(arg: string) {
        console.log("method called");
    }
    @debug()
    private helper() {
        console.log("helper called");
    }

    constructor() { this.helper() }
}

const testInstance = new TestClass();
testInstance.method("electric boogaloo");