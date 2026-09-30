// fm-compose: asks Apple's on-device model (FoundationModels) for structured output.
//
// Reads a JSON array of requests on stdin and writes one JSON line per request to stdout:
//   request:  {"id", "instructions", "prompt", "schema", "seed", "top_k", "temperature"}
//   response: {"id", "ok", "content" (the generated JSON as a string), "error", "elapsed_s"}
// "schema" is a small JSON description turned into a DynamicGenerationSchema, so guided
// generation can only produce the listed choices (for example the user's playable pitches):
//   {"type": "object", "name", "description", "properties": [{"name", "description", "schema"}]}
//   {"type": "array", "items": <schema>, "min", "max"}
//   {"type": "enum", "name", "description", "choices": ["C3", "G3", ...]}
// Sampling is .random(top: k, seed: seed): the same request gives the same answer on the
// same model version.

import Foundation
import FoundationModels

struct SchemaError: Error, CustomStringConvertible {
    let description: String
}

func buildSchema(_ any: Any?) throws -> DynamicGenerationSchema {
    guard let j = any as? [String: Any], let type = j["type"] as? String else {
        throw SchemaError(description: "schema node must be an object with a type")
    }
    let desc = j["description"] as? String
    switch type {
    case "object":
        let props = try (j["properties"] as? [[String: Any]] ?? []).map { p in
            DynamicGenerationSchema.Property(
                name: p["name"] as? String ?? "",
                description: p["description"] as? String,
                schema: try buildSchema(p["schema"])
            )
        }
        return DynamicGenerationSchema(name: j["name"] as? String ?? "Object", description: desc, properties: props)
    case "array":
        return DynamicGenerationSchema(
            arrayOf: try buildSchema(j["items"]),
            minimumElements: j["min"] as? Int,
            maximumElements: j["max"] as? Int
        )
    case "enum":
        return DynamicGenerationSchema(
            name: j["name"] as? String ?? "Choice",
            description: desc,
            anyOf: j["choices"] as? [String] ?? []
        )
    default:
        throw SchemaError(description: "unknown schema type \(type)")
    }
}

func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let requests = (try? JSONSerialization.jsonObject(with: input)) as? [[String: Any]] else {
    FileHandle.standardError.write("expected a JSON array of requests on stdin\n".data(using: .utf8)!)
    exit(2)
}

let model = SystemLanguageModel.default
guard model.isAvailable else {
    for r in requests {
        emit(["id": r["id"] ?? "", "ok": false, "error": "model unavailable: \(model.availability)"])
    }
    exit(0)
}

for r in requests {
    let id = r["id"] as? String ?? ""
    let start = Date()
    do {
        let schema = try GenerationSchema(root: try buildSchema(r["schema"]), dependencies: [])
        let seed = (r["seed"] as? NSNumber)?.uint64Value ?? 0
        let options = GenerationOptions(
            samplingMode: .random(top: r["top_k"] as? Int ?? 40, seed: seed),
            temperature: r["temperature"] as? Double
        )
        // A fresh session per request: no shared history, so each answer depends only on its request.
        let session = LanguageModelSession(instructions: r["instructions"] as? String ?? "")
        let response = try await session.respond(to: r["prompt"] as? String ?? "", schema: schema, options: options)
        emit([
            "id": id, "ok": true, "content": response.content.jsonString,
            "elapsed_s": Date().timeIntervalSince(start),
        ])
    } catch {
        emit(["id": id, "ok": false, "error": String(describing: error), "elapsed_s": Date().timeIntervalSince(start)])
    }
}
