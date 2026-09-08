# Photo Preflight Model

BlazeFace short-range float16, version 1, from Google MediaPipe:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

Usage and model information:
https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector

Runtime: @mediapipe/tasks-vision 0.10.32 (Apache-2.0), pinned in package.json.
The model and WASM runtime are served from the site's own origin. No photos,
landmarks or face descriptors are sent to an external recognition service.

This is a client-side quality preflight, not server-side access control,
identity verification, liveness detection or proof of unobscured features.
Existing stored photos are not reclassified. Face sharpness is measured on a
128px normalized central face region; thresholds deliberately reject only
obvious quality failures and require ongoing calibration with normal uploads.
