# Plane experiment

Run: 2026-09-05T23:49:40.080Z

## P1: ACCEPTED

```json
{
  "id": "P1",
  "attempts": [
    {
      "plane": "Top",
      "ids": [
        "JDC"
      ],
      "captureFile": "03-p1-resolve-top.json",
      "ok": true,
      "topIsJDC": true
    },
    {
      "plane": "Front",
      "ids": [
        "JCC"
      ],
      "captureFile": "04-p1-resolve-front.json",
      "ok": true
    },
    {
      "plane": "Right",
      "ids": [
        "JEC"
      ],
      "captureFile": "05-p1-resolve-right.json",
      "ok": true
    }
  ],
  "accepted": true
}
```

## P2: ACCEPTED

```json
{
  "id": "P2",
  "attempts": [
    {
      "plane": "Front",
      "variant": "a",
      "featureId": "FRxrXa6f0dYhJYf_0",
      "featureStatus": "OK",
      "accepted": true,
      "storedPlane": {
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
      "captureFile": "11-p2-front-a.json"
    },
    {
      "plane": "Front",
      "variant": "b",
      "featureId": "FhVlPDEPnbwsvl0_0",
      "featureStatus": "OK",
      "accepted": true,
      "storedPlane": {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCreatedBy(makeId(\"Front\"), EntityType.FACE);",
            "nodeId": "Mr1qeyAoQhQiQ0duP",
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
        "nodeId": "MnkqAm7GEBddLinbX",
        "parameterId": "plane",
        "parameterName": ""
      },
      "captureFile": "15-p2-front-b.json"
    },
    {
      "plane": "Front",
      "variant": "c",
      "accepted": false,
      "storedPlane": null,
      "captureFile": "19-p2-front-c.json"
    },
    {
      "plane": "Right",
      "variant": "a",
      "featureId": "FUkRAZOnR1muq0B_0",
      "featureStatus": "OK",
      "accepted": true,
      "storedPlane": {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$RightplaneOpS9$queryTypeS5$DUMMY\",id);",
            "nodeId": "MCE2MU4HIn3RGMU84",
            "deterministicIds": [
              "JEC"
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
        "nodeId": "MVxa4lk7jBwQh1RJ3",
        "parameterId": "plane",
        "parameterName": ""
      },
      "captureFile": "23-p2-right-a.json"
    },
    {
      "plane": "Right",
      "variant": "b",
      "featureId": "FNLdTj4CePGtxYI_0",
      "featureStatus": "OK",
      "accepted": true,
      "storedPlane": {
        "btType": "BTMParameterQueryList-148",
        "libraryRelationType": "DEFAULT",
        "queries": [
          {
            "btType": "BTMIndividualQuery-138",
            "queryString": "query=qCreatedBy(makeId(\"Right\"), EntityType.FACE);",
            "nodeId": "MOr1BR5c4P5gdyXn/",
            "deterministicIds": [
              "JEC"
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
        "nodeId": "M/Kby3lMCqa570G6s",
        "parameterId": "plane",
        "parameterName": ""
      },
      "captureFile": "27-p2-right-b.json"
    },
    {
      "plane": "Right",
      "variant": "c",
      "accepted": false,
      "storedPlane": null,
      "captureFile": "31-p2-right-c.json"
    }
  ],
  "accepted": true
}
```

## P3: ACCEPTED

```json
{
  "id": "P3",
  "accepted": true,
  "creation": {
    "featureId": "FHj3KVWEViMj8I3_0",
    "featureStatus": "OK",
    "accepted": true,
    "storedPlane": null,
    "captureFile": "35-p3-create-offset-plane.json"
  },
  "resolution": {
    "ids": [
      "JNC"
    ],
    "captureFile": "38-p3-resolve-offset-plane.json",
    "ok": true
  },
  "reference": {
    "featureId": "Fb39TwPNSDq5BMW_0",
    "featureStatus": "OK",
    "accepted": true,
    "storedPlane": {
      "btType": "BTMParameterQueryList-148",
      "libraryRelationType": "DEFAULT",
      "queries": [
        {
          "btType": "BTMIndividualQuery-138",
          "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S11.7$FHj3KVWEViMj8I3_0planeOpS9$queryTypeS5$DUMMY\",id);",
          "nodeId": "MLh/w3RpJd1OXGz6z",
          "deterministicIds": [
            "JNC"
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
      "nodeId": "M6Sygl5Mc6xwyMNEL",
      "parameterId": "plane",
      "parameterName": ""
    },
    "captureFile": "40-p3-reference-image.json"
  }
}
```

## P4: ACCEPTED

```json
{
  "id": "P4",
  "accepted": true,
  "creation": {
    "featureId": "FyjtorumyjA72Xu_0",
    "featureStatus": "OK",
    "accepted": true,
    "storedPlane": {
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
    },
    "captureFile": "44-p4-create-front-sketch.json"
  },
  "reference": {
    "featureId": "FUyaeqgmDxbYb0x_0",
    "featureStatus": "OK",
    "accepted": true,
    "storedPlane": {
      "btType": "BTMParameterQueryList-148",
      "libraryRelationType": "DEFAULT",
      "queries": [
        {
          "btType": "BTMIndividualQuery-138",
          "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$FrontplaneOpS9$queryTypeS5$DUMMY\",id);",
          "nodeId": "M8JhHQxgJQxPEoB9h",
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
      "nodeId": "M9JvzMRUL+zOeQavz",
      "parameterId": "plane",
      "parameterName": ""
    },
    "captureFile": "48-p4-reference-image.json"
  }
}
```

## P5: ACCEPTED

```json
{
  "id": "P5",
  "accepted": true,
  "featureId": "FRxrXa6f0dYhJYf_0",
  "featureStatus": "OK",
  "requestedPlane": {
    "btType": "BTMParameterQueryList-148",
    "libraryRelationType": "DEFAULT",
    "queries": [
      {
        "btType": "BTMIndividualQuery-138",
        "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$RightplaneOpS9$queryTypeS5$DUMMY\",id);",
        "nodeId": "MCE2MU4HIn3RGMU84",
        "deterministicIds": [
          "JEC"
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
    "nodeId": "MVxa4lk7jBwQh1RJ3",
    "parameterId": "plane",
    "parameterName": ""
  },
  "storedPlane": {
    "btType": "BTMParameterQueryList-148",
    "libraryRelationType": "DEFAULT",
    "queries": [
      {
        "btType": "BTMIndividualQuery-138",
        "queryString": "query=qCompressed(1.0,\"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S5.7$RightplaneOpS9$queryTypeS5$DUMMY\",id);",
        "nodeId": "MB3pmp0MPaoVznjKW",
        "deterministicIds": [
          "JEC"
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
    "nodeId": "M0kVcnQQU+C1fJvOY",
    "parameterId": "plane",
    "parameterName": ""
  },
  "storedPlaneMatches": true
}
```

No documents or features were deleted.
