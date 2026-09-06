FeatureScript 2770;
import(path : "onshape/std/common.fs", version : "2770.0");

// reference-align-feature: 1
// Version marker. The app recognises an installed Feature Studio by this
// exact token, so it can tell "already installed" from "a studio that looks
// similar" without diffing source an operator may have edited. Bump the
// number only when an installed studio must be replaced rather than reused.

// A reference image may sit on either side of the selected plane's canonical
// origin, so these coordinate bounds must allow signed lengths.
const SIGNED_LENGTH_BOUNDS = {
        (meter) : [-100000, 0, 100000]
    } as LengthBoundSpec;

const IMAGE_WIDTH_BOUNDS = {
        (meter) : [0.000001, 0.25, 100000]
    } as LengthBoundSpec;

const FULL_ANGLE_BOUNDS = {
        (degree) : [-360000, 0, 360000]
    } as AngleBoundSpec;

annotation { "Feature Type Name" : "Calibrated Reference Image" }
export const referenceImage = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Image" }
        definition.image is ImageData;

        annotation {
            "Name" : "Sketch plane",
            "Filter" : EntityType.FACE && GeometryType.PLANE,
            "MaxNumberOfPicks" : 1
        }
        definition.plane is Query;

        annotation { "Name" : "Image width" }
        isLength(definition.imageWidth, IMAGE_WIDTH_BOUNDS);

        annotation { "Name" : "Image angle" }
        isAngle(definition.imageAngle, FULL_ANGLE_BOUNDS);

        annotation { "Name" : "Origin X" }
        isLength(definition.originX, SIGNED_LENGTH_BOUNDS);

        annotation { "Name" : "Origin Y" }
        isLength(definition.originY, SIGNED_LENGTH_BOUNDS);
    }
    {
        // Match the same canonical coordinate system that a normal sketch on the
        // selected plane would use. The app expresses originX/originY in this
        // coordinate system.
        const basePlane = alignCanonically(context, evPlane(context, {
                    "face" : definition.plane
                }));
        const baseY = yAxis(basePlane);

        // Turn the image placement into a custom sketch plane. skImage itself is
        // axis-aligned in its sketch, while the custom plane carries translation
        // and rotation in the selected plane.
        const imageOriginWorld = planeToWorld(basePlane,
                vector(definition.originX, definition.originY));
        const imageXWorld = cos(definition.imageAngle) * basePlane.x +
                sin(definition.imageAngle) * baseY;
        const imagePlane = plane(imageOriginWorld, basePlane.normal, imageXWorld);

        var imageSketch = newSketchOnPlane(context, id + "imageSketch", {
                "sketchPlane" : imagePlane
            });

        // Giving skImage a horizontal width vector preserves source aspect ratio
        // and makes Onshape calculate the image height automatically.
        skImage(imageSketch, "referenceImage", {
                "blobInfo" : definition.image,
                "firstCorner" : vector(0 * meter, 0 * meter),
                "secondCorner" : vector(definition.imageWidth, 0 * meter)
            });
        skSolve(imageSketch);
    });
