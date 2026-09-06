// Copied verbatim from the data.feature fields in the successful live run
// docs/experiments/2026-09-05-plane-experiment-t5N9Xx/:
// 35-p3-create-offset-plane.json, 44-p4-create-front-sketch.json,
// and 11-p2-front-a.json. Factories prevent test mutations leaking.

export function capturedPlane() {
  return {
    "btType": "BTMFeature-134",
    "namespace": "",
    "name": "P3 offset plane",
    "suppressed": false,
    "parameters": [
      {
        "btType": "BTMParameterEnum-145",
        "namespace": "",
        "nodeId": "M89gS+om1nJkGGK0f",
        "libraryRelationType": "DEFAULT",
        "value": "OFFSET",
        "parameterId": "cplaneType",
        "parameterName": "",
        "enumName": "CPlaneType"
      },
      {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY\",id);",
            "nodeId": "MojohxEUeS5HvJ4LL",
            "deterministicIds": [
              "JDC"
            ],
            "queryStatement": null
          }
        ],
        "filter": {
          "btType": "BTOrFilter-167",
          "operand1": {
            "btType": "BTOrFilter-167",
            "operand1": {
              "btType": "BTOrFilter-167",
              "operand1": {
                "btType": "BTOrFilter-167",
                "operand1": {
                  "btType": "BTOrFilter-167",
                  "operand1": {
                    "btType": "BTGeometryFilter-130",
                    "geometryType": "PLANE"
                  },
                  "operand2": {
                    "btType": "BTEntityTypeFilter-124",
                    "entityType": "VERTEX"
                  }
                },
                "operand2": {
                  "btType": "BTOrFilter-167",
                  "operand1": {
                    "btType": "BTOrFilter-167",
                    "operand1": {
                      "btType": "BTGeometryFilter-130",
                      "geometryType": "LINE"
                    },
                    "operand2": {
                      "btType": "BTOrFilter-167",
                      "operand1": {
                        "btType": "BTGeometryFilter-130",
                        "geometryType": "CIRCLE"
                      },
                      "operand2": {
                        "btType": "BTOrFilter-167",
                        "operand1": {
                          "btType": "BTGeometryFilter-130",
                          "geometryType": "ARC"
                        },
                        "operand2": {
                          "btType": "BTOrFilter-167",
                          "operand1": {
                            "btType": "BTGeometryFilter-130",
                            "geometryType": "CYLINDER"
                          },
                          "operand2": {
                            "btType": "BTOrFilter-167",
                            "operand1": {
                              "btType": "BTGeometryFilter-130",
                              "geometryType": "CONE"
                            },
                            "operand2": {
                              "btType": "BTGeometryFilter-130",
                              "geometryType": "REVOLVED"
                            }
                          }
                        }
                      }
                    }
                  },
                  "operand2": {
                    "btType": "BTMateConnectorFilter-163",
                    "requiresOccurrence": false,
                    "allowImplicitMateConnector": false,
                    "isMateConnectorInferenceEnabledByDefault": false
                  }
                }
              },
              "operand2": {
                "btType": "BTEntityTypeFilter-124",
                "entityType": "EDGE"
              }
            },
            "operand2": {
              "btType": "BTBodyTypeFilter-112",
              "bodyType": "MATE_CONNECTOR"
            }
          },
          "operand2": {
            "btType": "BTAllowMeshGeometryFilter-1026",
            "allowsMeshGeometry": true
          }
        },
        "nodeId": "MEIX7lfv/w/QeVV3v",
        "parameterId": "entities",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQuantity-147",
        "libraryRelationType": "DEFAULT",
        "isInteger": false,
        "value": 0,
        "units": "",
        "expression": "0.01 m",
        "nodeId": "MIzfOnxF2SSUZ85PG",
        "parameterId": "offset",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterBoolean-144",
        "libraryRelationType": "DEFAULT",
        "value": false,
        "nodeId": "MjfbIwBTJQ3KV5lvO",
        "parameterId": "oppositeDirection",
        "parameterName": ""
      }
    ],
    "featureId": "FHj3KVWEViMj8I3_0",
    "nodeId": "Mbtu1lOOEKdnVQLcA",
    "featureType": "cPlane",
    "returnAfterSubfeatures": false,
    "subFeatures": [],
    "suppressionState": null,
    "parameterLibraries": []
  };
}
export function capturedSketch() {
  return {
    "btType": "BTMSketch-151",
    "parameterLibraries": [],
    "returnAfterSubfeatures": false,
    "subFeatures": [],
    "entities": [],
    "constraints": [],
    "namespace": "",
    "name": "P4 Front sketch",
    "parameters": [
      {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$FrontplaneOpS9$queryTypeS5$DUMMY\",id);",
            "nodeId": "MPzF2/1nOSYE0w0Pm",
            "deterministicIds": [
              "JCC"
            ],
            "queryStatement": null
          }
        ],
        "filter": {
          "btType": "BTOrFilter-167",
          "operand1": {
            "btType": "BTOrFilter-167",
            "operand1": {
              "btType": "BTAndFilter-110",
              "operand1": {
                "btType": "BTGeometryFilter-130",
                "geometryType": "PLANE"
              },
              "operand2": {
                "btType": "BTFlatSheetMetalFilter-3018",
                "allows": "MODEL_ONLY"
              }
            },
            "operand2": {
              "btType": "BTAndFilter-110",
              "operand1": {
                "btType": "BTAndFilter-110",
                "operand1": {
                  "btType": "BTSMDefinitionEntityTypeFilter-1651",
                  "smDefinitionEntityType": "FACE"
                },
                "operand2": {
                  "btType": "BTFlatSheetMetalFilter-3018",
                  "allows": "MODEL_AND_FLATTENED"
                }
              },
              "operand2": {
                "btType": "BTGeometryFilter-130",
                "geometryType": "PLANE"
              }
            }
          },
          "operand2": {
            "btType": "BTBodyTypeFilter-112",
            "bodyType": "MATE_CONNECTOR"
          }
        },
        "nodeId": "MB08muyFr6em+zxp4",
        "parameterId": "sketchPlane",
        "parameterName": ""
      }
    ],
    "nodeId": "MEMDzgszd5I7nL1F+",
    "featureId": "FyjtorumyjA72Xu_0",
    "suppressed": false,
    "featureType": "newSketch",
    "suppressionState": null
  };
}

export function capturedReference() {
  return {
    "btType": "BTMFeature-134",
    "namespace": "ea11ce0000000000000000022::ma11ce0000000000000000157",
    "name": "P2 Front a",
    "suppressed": false,
    "parameters": [
      {
        "btType": "BTMParameterReferenceImage-2014",
        "elementLibraryData": null,
        "libraryRelationType": "DEFAULT",
        "namespace": "ea11ce0000000000000000155::ma11ce0000000000000000101",
        "nodeId": "MAGebIdpncBv0S9e7",
        "parameterId": "image",
        "parameterName": ""
      },
      {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$FrontplaneOpS9$queryTypeS5$DUMMY\",id);",
            "nodeId": "MOIA9yeudRmyULloc",
            "deterministicIds": [
              "JCC"
            ],
            "queryStatement": null
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
        "nodeId": "Mfn6UuVAg8Axm5qCZ",
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
        "nodeId": "MzEvvj8TQUi6GzpQy",
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
        "nodeId": "Mr1q784sIPZy0hNXT",
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
        "nodeId": "MJCSkGxEF3/tEES44",
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
        "nodeId": "M1QjuxEX//vpCy7Ha",
        "parameterId": "originY",
        "parameterName": ""
      }
    ],
    "featureId": "FRxrXa6f0dYhJYf_0",
    "nodeId": "MNIi75ctiBDsEYBcO",
    "featureType": "referenceImage",
    "returnAfterSubfeatures": false,
    "subFeatures": [],
    "suppressionState": null,
    "parameterLibraries": []
  };
}
