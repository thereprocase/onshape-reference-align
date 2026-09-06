// Real Onshape payloads, copied verbatim from the write-shape experiment
// captures under docs/experiments/2026-09-04-bind-experiment/. Each export
// names the capture file it came from.
//
// ADD_FEATURE_REQUEST is the exact body Onshape accepted with
// featureStatus OK (E3, variant a). The payload builder is compared against
// it byte for byte, so a reordered key or a dropped field fails here rather
// than against a real document.

// Source: 14-e3-features-refresh-a.json (responseBody) — the feature list read
// immediately before the add, and the source of the envelope fields.
export const FEATURE_LIST_BEFORE_ADD = Object.freeze({
    "btType": "BTFeatureListResponse-2457",
    "isComplete": true,
    "serializationVersion": "1.2.21",
    "rollbackIndex": 0,
    "features": [],
    "sourceMicroversion": "a11ce0000000000000000054",
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

// Source: 15-e3-add-feature-a.json (requestBody) — accepted, featureStatus OK.
export const ADD_FEATURE_REQUEST = Object.freeze({
    "btType": "BTFeatureDefinitionCall-1406",
    "feature": {
      "btType": "BTMFeature-134",
      "featureType": "referenceImage",
      "name": "Calibrated Reference Image 1",
      "namespace": "ea11ce0000000000000000114::ma11ce0000000000000000030",
      "parameters": [
        {
          "btType": "BTMParameterReferenceImage-2014",
          "namespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
          "parameterId": "image",
          "elementLibraryData": null
        },
        {
          "btType": "BTMParameterQueryList-148",
          "queries": [
            {
              "btType": "BTMIndividualQuery-138",
              "queryStatement": null,
              "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY\",id);",
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
          "parameterId": "plane"
        },
        {
          "btType": "BTMParameterQuantity-147",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0.25 m",
          "parameterId": "imageWidth"
        },
        {
          "btType": "BTMParameterQuantity-147",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 deg",
          "parameterId": "imageAngle"
        },
        {
          "btType": "BTMParameterQuantity-147",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 m",
          "parameterId": "originX"
        },
        {
          "btType": "BTMParameterQuantity-147",
          "isInteger": false,
          "value": 0,
          "units": "",
          "expression": "0 m",
          "parameterId": "originY"
        }
      ]
    },
    "serializationVersion": "1.2.21",
    "sourceMicroversion": "a11ce0000000000000000054",
    "libraryVersion": 3070,
    "rejectMicroversionSkew": false
  });

// Source: 15-e3-add-feature-a.json (responseBody).
export const ADD_FEATURE_RESPONSE = Object.freeze({
    "btType": "BTFeatureDefinitionResponse-1617",
    "rejectMicroversionSkew": false,
    "microversionSkew": false,
    "featureState": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "feature": {
      "btType": "BTMFeature-134",
      "name": "Calibrated Reference Image 1",
      "suppressed": false,
      "parameters": [
        {
          "btType": "BTMParameterReferenceImage-2014",
          "elementLibraryData": null,
          "libraryRelationType": "DEFAULT",
          "namespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
          "nodeId": "MyO1O5xHBQgyPcLyK",
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
              "nodeId": "ML7gvoviCIOcIviFu",
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
          "nodeId": "Msl9WxVeASffYj3wR",
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
          "nodeId": "MvmNFzaa8SGt5o2Vq",
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
          "nodeId": "MUWW2Qm6GsYHYDKKR",
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
          "nodeId": "M/sE9Bb5RSFqlhZG6",
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
          "nodeId": "MCBgboXOmc2ZawoH2",
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
    "sourceMicroversion": "a11ce0000000000000000134",
    "libraryVersion": 0
  });

// Source: 16-e3-features-after.json (responseBody) — the same Part Studio with
// the instance present.
export const FEATURE_LIST_WITH_INSTANCE = Object.freeze({
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
            "namespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
            "nodeId": "MyO1O5xHBQgyPcLyK",
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
                "nodeId": "ML7gvoviCIOcIviFu",
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
            "nodeId": "Msl9WxVeASffYj3wR",
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
            "nodeId": "MvmNFzaa8SGt5o2Vq",
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
            "nodeId": "MUWW2Qm6GsYHYDKKR",
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
            "nodeId": "M/sE9Bb5RSFqlhZG6",
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
            "nodeId": "MCBgboXOmc2ZawoH2",
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
    "sourceMicroversion": "a11ce0000000000000000134",
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
        "featureStatus": "OK",
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

// Source: 18-e4-rebind-a.json (requestBody) — the accepted rebind: the whole
// stored feature posted back with only image.namespace changed.
export const REBIND_REQUEST = Object.freeze({
    "btType": "BTFeatureDefinitionCall-1406",
    "feature": {
      "btType": "BTMFeature-134",
      "name": "Calibrated Reference Image 1",
      "suppressed": false,
      "parameters": [
        {
          "btType": "BTMParameterReferenceImage-2014",
          "elementLibraryData": null,
          "libraryRelationType": "DEFAULT",
          "namespace": "ea11ce0000000000000000026::ma11ce0000000000000000125",
          "nodeId": "MyO1O5xHBQgyPcLyK",
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
              "nodeId": "ML7gvoviCIOcIviFu",
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
          "nodeId": "Msl9WxVeASffYj3wR",
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
          "nodeId": "MvmNFzaa8SGt5o2Vq",
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
          "nodeId": "MUWW2Qm6GsYHYDKKR",
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
          "nodeId": "M/sE9Bb5RSFqlhZG6",
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
          "nodeId": "MCBgboXOmc2ZawoH2",
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
    "sourceMicroversion": "a11ce0000000000000000134",
    "libraryVersion": 3070,
    "rejectMicroversionSkew": false
  });

// Source: 18-e4-rebind-a.json (responseBody).
export const REBIND_RESPONSE = Object.freeze({
    "btType": "BTFeatureDefinitionResponse-1617",
    "rejectMicroversionSkew": false,
    "microversionSkew": false,
    "featureState": {
      "btType": "BTFeatureState-1688",
      "featureStatus": "OK",
      "inactive": false
    },
    "feature": {
      "btType": "BTMFeature-134",
      "name": "Calibrated Reference Image 1",
      "suppressed": false,
      "parameters": [
        {
          "btType": "BTMParameterReferenceImage-2014",
          "elementLibraryData": null,
          "libraryRelationType": "DEFAULT",
          "namespace": "ea11ce0000000000000000026::ma11ce0000000000000000125",
          "nodeId": "MdfiHf/iqTHlEi0+1",
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
              "nodeId": "MpdMwwEGPi38mzxx5",
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
          "nodeId": "MFV5mm1RiDqrwD+jN",
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
          "nodeId": "M3Q3jiOOqkc3Wowws",
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
          "nodeId": "MEhKoupKmW1+Y5GTi",
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
          "nodeId": "MUrws/AmgUDomAbgK",
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
          "nodeId": "MbT1C4jg20t/GZ4F9",
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
    "sourceMicroversion": "a11ce0000000000000000012",
    "libraryVersion": 0
  });

// Source: 17-e4-features-before-a.json (responseBody) — the feature list read
// immediately before that rebind.
export const FEATURE_LIST_BEFORE_REBIND = Object.freeze({
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
            "namespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
            "nodeId": "MyO1O5xHBQgyPcLyK",
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
                "nodeId": "ML7gvoviCIOcIviFu",
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
            "nodeId": "Msl9WxVeASffYj3wR",
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
            "nodeId": "MvmNFzaa8SGt5o2Vq",
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
            "nodeId": "MUWW2Qm6GsYHYDKKR",
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
            "nodeId": "M/sE9Bb5RSFqlhZG6",
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
            "nodeId": "MCBgboXOmc2ZawoH2",
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
    "sourceMicroversion": "a11ce0000000000000000134",
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
        "featureStatus": "OK",
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

// Source: 10-e2-fs-read-contents.json (responseBody) — the Feature Studio
// contents Onshape stored and read back byte-identical.
export const FEATURE_STUDIO_READ = Object.freeze({
    "btType": "BTFeatureStudioContents-2239",
    "contents": "FeatureScript 2770;\nimport(path : \"onshape/std/common.fs\", version : \"2770.0\");\n\n// A reference image may sit on either side of the selected plane's canonical\n// origin, so these coordinate bounds must allow signed lengths.\nconst SIGNED_LENGTH_BOUNDS = {\n        (meter) : [-100000, 0, 100000]\n    } as LengthBoundSpec;\n\nconst IMAGE_WIDTH_BOUNDS = {\n        (meter) : [0.000001, 0.25, 100000]\n    } as LengthBoundSpec;\n\nconst FULL_ANGLE_BOUNDS = {\n        (degree) : [-360000, 0, 360000]\n    } as AngleBoundSpec;\n\nannotation { \"Feature Type Name\" : \"Calibrated Reference Image\" }\nexport const referenceImage = defineFeature(function(context is Context, id is Id, definition is map)\n    precondition\n    {\n        annotation { \"Name\" : \"Image\" }\n        definition.image is ImageData;\n\n        annotation {\n            \"Name\" : \"Sketch plane\",\n            \"Filter\" : EntityType.FACE && GeometryType.PLANE,\n            \"MaxNumberOfPicks\" : 1\n        }\n        definition.plane is Query;\n\n        annotation { \"Name\" : \"Image width\" }\n        isLength(definition.imageWidth, IMAGE_WIDTH_BOUNDS);\n\n        annotation { \"Name\" : \"Image angle\" }\n        isAngle(definition.imageAngle, FULL_ANGLE_BOUNDS);\n\n        annotation { \"Name\" : \"Origin X\" }\n        isLength(definition.originX, SIGNED_LENGTH_BOUNDS);\n\n        annotation { \"Name\" : \"Origin Y\" }\n        isLength(definition.originY, SIGNED_LENGTH_BOUNDS);\n    }\n    {\n        // Match the same canonical coordinate system that a normal sketch on the\n        // selected plane would use. The app expresses originX/originY in this\n        // coordinate system.\n        const basePlane = alignCanonically(context, evPlane(context, {\n                    \"face\" : definition.plane\n                }));\n        const baseY = yAxis(basePlane);\n\n        // Turn the image placement into a custom sketch plane. skImage itself is\n        // axis-aligned in its sketch, while the custom plane carries translation\n        // and rotation in the selected plane.\n        const imageOriginWorld = planeToWorld(basePlane,\n                vector(definition.originX, definition.originY));\n        const imageXWorld = cos(definition.imageAngle) * basePlane.x +\n                sin(definition.imageAngle) * baseY;\n        const imagePlane = plane(imageOriginWorld, basePlane.normal, imageXWorld);\n\n        var imageSketch = newSketchOnPlane(context, id + \"imageSketch\", {\n                \"sketchPlane\" : imagePlane\n            });\n\n        // Giving skImage a horizontal width vector preserves source aspect ratio\n        // and makes Onshape calculate the image height automatically.\n        skImage(imageSketch, \"referenceImage\", {\n                \"blobInfo\" : definition.image,\n                \"firstCorner\" : vector(0 * meter, 0 * meter),\n                \"secondCorner\" : vector(definition.imageWidth, 0 * meter)\n            });\n        skSolve(imageSketch);\n    });\n",
    "rejectMicroversionSkew": false,
    "microversionSkew": false,
    "libraryVersion": 0,
    "sourceMicroversion": "a11ce0000000000000000054",
    "serializationVersion": "1.2.21"
  });

// Source: 08-e2-fs-create.json (responseBody) — note its microversionId is the
// one from before the contents were set, which is why the install route
// re-reads the elements listing instead of trusting it.
export const FEATURE_STUDIO_CREATE_RESPONSE = Object.freeze({
    "name": "Reference Align Features",
    "id": "a11ce0000000000000000114",
    "type": "Feature Studio",
    "elementType": "FEATURESTUDIO",
    "angleUnits": null,
    "massUnits": null,
    "timeUnits": null,
    "forceUnits": null,
    "pressureUnits": null,
    "momentUnits": null,
    "accelerationUnits": null,
    "angularVelocityUnits": null,
    "energyUnits": null,
    "areaUnits": null,
    "volumeUnits": null,
    "densityUnits": null,
    "frequencyUnits": null,
    "lengthUnits": null,
    "filename": null,
    "thumbnailInfo": null,
    "thumbnails": null,
    "microversionId": "a11ce0000000000000000153",
    "dataType": "onshape/featurestudio",
    "applicationTarget": null,
    "foreignDataId": null,
    "unupdatable": false,
    "safeToShow": false,
    "specifiedUnit": null,
    "prettyType": null,
    "zip": null
  });

// Source: 05-e1-upload-plain.json (responseBody) — the blob upload response,
// which carries both the new element id and its microversion.
export const BLOB_UPLOAD_RESPONSE = Object.freeze({
    "translationId": null,
    "translationEventKey": "",
    "name": "reference-align-icon-a.png",
    "id": "a11ce0000000000000000120",
    "type": "Blob",
    "elementType": "BLOB",
    "angleUnits": null,
    "massUnits": null,
    "timeUnits": null,
    "forceUnits": null,
    "pressureUnits": null,
    "momentUnits": null,
    "accelerationUnits": null,
    "angularVelocityUnits": null,
    "energyUnits": null,
    "areaUnits": null,
    "volumeUnits": null,
    "densityUnits": null,
    "frequencyUnits": null,
    "lengthUnits": null,
    "dataType": "image/png",
    "filename": "reference-align-icon-a.png",
    "thumbnailInfo": null,
    "microversionId": "a11ce0000000000000000010",
    "thumbnails": null,
    "applicationTarget": null,
    "foreignDataId": "a11ce0000000000000000076",
    "unupdatable": false,
    "safeToShow": false,
    "specifiedUnit": "",
    "prettyType": null,
    "zip": null
  });
