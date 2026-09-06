// Real Onshape payloads from the suppression experiment (E5), copied verbatim
// from the captures under docs/experiments/2026-09-04-bind-experiment/. Each
// export names the capture file it came from.
//
// E5 established two things this product depends on: the field is
// "suppressed" on BTMFeature-134, and posting the whole feature back with it
// flipped round-trips. SUPPRESS_TRUE_REQUEST is the exact body Onshape
// accepted with featureStatus OK, so the payload builder is compared against
// it field for field rather than against a shape someone believed was right.

// Source: 26-e5-features-before-true.json (responseBody) — the feature list
// read immediately before the suppression write.
export const FEATURE_LIST_BEFORE_SUPPRESS = Object.freeze({
  "btType": "BTFeatureListResponse-2457",
  "isComplete": true,
  "serializationVersion": "1.2.21",
  "rollbackIndex": 1,
  "features": [
    {
      "btType": "BTMFeature-134",
      "name": "Calibrated Reference Image 1",
      "suppressed": false,
      "parameters": [
        {
          "btType": "BTMParameterReferenceImage-2014",
          "elementLibraryData": null,
          "libraryRelationType": "DEFAULT",
          "namespace": "da11ce0000000000000000039::wa11ce0000000000000000052::ea11ce0000000000000000026::ma11ce0000000000000000125",
          "nodeId": "MA//AAewT57h0ERgm",
          "parameterId": "image",
          "parameterName": ""
        },
        {
          "btType": "BTMParameterQueryList-148",
          "libraryRelationType": "DEFAULT",
          "queries": [
            {
              "btType": "BTMIndividualQuery-138",
              "queryStatement": null,
              "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY\",id);",
              "nodeId": "Mb3EVz7uYU664LpEL",
              "deterministicIds": [
                "JDC"
              ]
            }
          ],
          "filter": {
            "btType": "BTAndFilter-110",
            "operand1": {
              "btType": "BTEntityTypeFilter-124",
              "entityType": "FACE"
            },
            "operand2": {
              "btType": "BTGeometryFilter-130",
              "geometryType": "PLANE"
            }
          },
          "nodeId": "MBA43BZrvbUjNfH5p",
          "parameterId": "plane",
          "parameterName": ""
        },
        {
          "btType": "BTMParameterQuantity-147",
          "libraryRelationType": "DEFAULT",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0.25 m",
          "nodeId": "M2waUzkKb3I+G8W5b",
          "parameterId": "imageWidth",
          "parameterName": ""
        },
        {
          "btType": "BTMParameterQuantity-147",
          "libraryRelationType": "DEFAULT",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 deg",
          "nodeId": "MAcPrEOg/0BjXUn2e",
          "parameterId": "imageAngle",
          "parameterName": ""
        },
        {
          "btType": "BTMParameterQuantity-147",
          "libraryRelationType": "DEFAULT",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 m",
          "nodeId": "MElgJP3FSNLTElkNb",
          "parameterId": "originX",
          "parameterName": ""
        },
        {
          "btType": "BTMParameterQuantity-147",
          "libraryRelationType": "DEFAULT",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 m",
          "nodeId": "MeAbDVUwxm0MXHgsJ",
          "parameterId": "originY",
          "parameterName": ""
        }
      ],
      "namespace": "ea11ce0000000000000000114::ma11ce0000000000000000030",
      "featureId": "FycByd6CdezIhLo_0",
      "nodeId": "MnlguVoEJ2FYpsz0p",
      "featureType": "referenceImage",
      "returnAfterSubfeatures": false,
      "subFeatures": [],
      "parameterLibraries": [],
      "suppressionState": null
    }
  ],
  "sourceMicroversion": "a11ce0000000000000000021",
  "microversionSkew": false,
  "rejectMicroversionSkew": false,
  "libraryVersion": 3070,
  "featureStates": {
    "Origin": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "Top": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "Front": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "Right": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "FycByd6CdezIhLo_0": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "ERROR",
      "inactive": false
    }
  },
  "imports": [
    {
      "btType": "BTMImport-136",
      "namespace": "",
      "nodeId": "MGRwledvRIWswbPHa",
      "path": "onshape/std/geometry.fs",
      "version": "3070.0"
    }
  ],
  "defaultFeatures": [
    {
      "btType": "BTMFeature-134",
      "name": "Origin",
      "suppressed": false,
      "parameters": [],
      "namespace": "",
      "featureId": "Origin",
      "nodeId": "MDtaODPLoerbOpZWY",
      "featureType": "origin",
      "returnAfterSubfeatures": false,
      "subFeatures": [],
      "parameterLibraries": [],
      "suppressionState": null
    },
    {
      "btType": "BTMFeature-134",
      "name": "Top",
      "suppressed": false,
      "parameters": [],
      "namespace": "",
      "featureId": "Top",
      "nodeId": "MVA24WI4pffnMT3to",
      "featureType": "defaultPlane",
      "returnAfterSubfeatures": false,
      "subFeatures": [],
      "parameterLibraries": [],
      "suppressionState": null
    },
    {
      "btType": "BTMFeature-134",
      "name": "Front",
      "suppressed": false,
      "parameters": [],
      "namespace": "",
      "featureId": "Front",
      "nodeId": "MTLrLz2Z/2ychXFPP",
      "featureType": "defaultPlane",
      "returnAfterSubfeatures": false,
      "subFeatures": [],
      "parameterLibraries": [],
      "suppressionState": null
    },
    {
      "btType": "BTMFeature-134",
      "name": "Right",
      "suppressed": false,
      "parameters": [],
      "namespace": "",
      "featureId": "Right",
      "nodeId": "MUgqiP9lV1BMeDw8X",
      "featureType": "defaultPlane",
      "returnAfterSubfeatures": false,
      "subFeatures": [],
      "parameterLibraries": [],
      "suppressionState": null
    }
  ]
});

// Source: 27-e5-suppressed-true.json (requestBody) — accepted, featureStatus OK.
export const SUPPRESS_TRUE_REQUEST = Object.freeze({
  "btType": "BTFeatureDefinitionCall-1406",
  "feature": {
    "btType": "BTMFeature-134",
    "name": "Calibrated Reference Image 1",
    "suppressed": true,
    "parameters": [
      {
        "btType": "BTMParameterReferenceImage-2014",
        "elementLibraryData": null,
        "libraryRelationType": "DEFAULT",
        "namespace": "da11ce0000000000000000039::wa11ce0000000000000000052::ea11ce0000000000000000026::ma11ce0000000000000000125",
        "nodeId": "MA//AAewT57h0ERgm",
        "parameterId": "image",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryStatement": null,
            "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY\",id);",
            "nodeId": "Mb3EVz7uYU664LpEL",
            "deterministicIds": [
              "JDC"
            ]
          }
        ],
        "filter": {
          "btType": "BTAndFilter-110",
          "operand1": {
            "btType": "BTEntityTypeFilter-124",
            "entityType": "FACE"
          },
          "operand2": {
            "btType": "BTGeometryFilter-130",
            "geometryType": "PLANE"
          }
        },
        "nodeId": "MBA43BZrvbUjNfH5p",
        "parameterId": "plane",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQuantity-147",
        "libraryRelationType": "DEFAULT",
        "isInteger": false,
        "value": 0,
        "units": "",
        "expression": "0.25 m",
        "nodeId": "M2waUzkKb3I+G8W5b",
        "parameterId": "imageWidth",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQuantity-147",
        "libraryRelationType": "DEFAULT",
        "isInteger": false,
        "value": 0,
        "units": "",
        "expression": "0 deg",
        "nodeId": "MAcPrEOg/0BjXUn2e",
        "parameterId": "imageAngle",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQuantity-147",
        "libraryRelationType": "DEFAULT",
        "isInteger": false,
        "value": 0,
        "units": "",
        "expression": "0 m",
        "nodeId": "MElgJP3FSNLTElkNb",
        "parameterId": "originX",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQuantity-147",
        "libraryRelationType": "DEFAULT",
        "isInteger": false,
        "value": 0,
        "units": "",
        "expression": "0 m",
        "nodeId": "MeAbDVUwxm0MXHgsJ",
        "parameterId": "originY",
        "parameterName": ""
      }
    ],
    "namespace": "ea11ce0000000000000000114::ma11ce0000000000000000030",
    "featureId": "FycByd6CdezIhLo_0",
    "nodeId": "MnlguVoEJ2FYpsz0p",
    "featureType": "referenceImage",
    "returnAfterSubfeatures": false,
    "subFeatures": [],
    "parameterLibraries": [],
    "suppressionState": null
  },
  "serializationVersion": "1.2.21",
  "sourceMicroversion": "a11ce0000000000000000021",
  "libraryVersion": 3070,
  "rejectMicroversionSkew": false
});
