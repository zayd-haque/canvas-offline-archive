// Local-only PDF rasterization and text recognition. One JSON record per page
// allows Python to retain completed pages if the overall process times out.
import Foundation
import PDFKit
import Vision
import AppKit

struct PageResult: Codable {
    let page: Int
    let text: String
    let error: String?
}

func emit(_ result: PageResult) {
    if let data = try? JSONEncoder().encode(result) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}

func recognize(_ page: PDFPage) throws -> String {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width.isFinite, bounds.height.isFinite,
          bounds.width > 0, bounds.height > 0 else {
        throw NSError(domain: "CanvasOCR", code: 1)
    }
    // Cap raster dimensions and memory; about 200 dpi for a normal letter page.
    let scale = min(200.0 / 72.0, 2400.0 / max(bounds.width, bounds.height))
    let size = NSSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    let image = page.thumbnail(of: size, for: .mediaBox)
    var rect = CGRect(origin: .zero, size: image.size)
    guard let bitmap = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        throw NSError(domain: "CanvasOCR", code: 2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }
    try VNImageRequestHandler(cgImage: bitmap, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let args = CommandLine.arguments
if args.count != 3 {
    exit(2)
}
guard let document = PDFDocument(url: URL(fileURLWithPath: args[1])), !document.isLocked else {
    exit(3)
}
let numbers = args[2].split(separator: ",").compactMap { Int($0) }.prefix(100)
for number in numbers {
    autoreleasepool {
        guard number > 0, number <= document.pageCount, let page = document.page(at: number - 1) else {
            emit(PageResult(page: number, text: "", error: "page_unavailable"))
            return
        }
        do {
            emit(PageResult(page: number, text: String(try recognize(page).prefix(100_000)), error: nil))
        } catch {
            emit(PageResult(page: number, text: "", error: "recognition_failed"))
        }
    }
}
