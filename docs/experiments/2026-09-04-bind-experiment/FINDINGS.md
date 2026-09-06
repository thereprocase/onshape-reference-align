# Onshape write-shape experiment findings

Run: 2026-09-05T10:24:33.984Z

| Field | Value |
| --- | --- |
| Document id | `a11ce0000000000000000039` |
| Workspace id | `a11ce0000000000000000052` |
| Part Studio element id | `a11ce0000000000000000027` |
| Feature Studio element id | `a11ce0000000000000000114` |
| Blob element ids | `a11ce0000000000000000120`, `a11ce0000000000000000026` |
| Feature id | `FycByd6CdezIhLo_0` |
| Part Studio URL | https://cad.onshape.com/documents/a11ce0000000000000000039/w/a11ce0000000000000000052/e/a11ce0000000000000000027 |
| Document visibility | PUBLIC |

Request and response captures live beside this file as `NN-<name>.json`.
Email-like strings and owner/creator records are redacted.

## E0 — REJECTED

**Question:** Can this account create a new private document via POST /documents?

**Detail:**

```json
{
  "privateRequestAccepted": false,
  "freeAccountRejectsPrivateDocuments": true,
  "publicFallbackUsed": true,
  "acceptedRequestShape": {
    "name": "Reference Align scratch — safe to delete",
    "isPublic": true
  }
}
```

## E1 — ACCEPTED

**Question:** Can a blob element be created by signed multipart POST to /blobelements/d/{did}/w/{wid}?

**Attempts:**

```json
[
  {
    "variant": "a",
    "description": "file + encodedFilename only",
    "status": 200,
    "ok": true,
    "elementId": "a11ce0000000000000000120",
    "message": null
  }
]
```

**Detail:**

```json
{
  "firstBlobElementId": "a11ce0000000000000000120",
  "secondBlobElementId": "a11ce0000000000000000026",
  "responseHasMicroversionId": true,
  "firstBlobMicroversionId": "a11ce0000000000000000010",
  "responseKeys": [
    "accelerationUnits",
    "angleUnits",
    "angularVelocityUnits",
    "applicationTarget",
    "areaUnits",
    "dataType",
    "densityUnits",
    "elementType",
    "energyUnits",
    "filename",
    "forceUnits",
    "foreignDataId",
    "frequencyUnits",
    "id",
    "lengthUnits",
    "massUnits",
    "microversionId",
    "momentUnits",
    "name",
    "pressureUnits",
    "prettyType",
    "safeToShow",
    "specifiedUnit",
    "thumbnailInfo",
    "thumbnails",
    "timeUnits",
    "translationEventKey",
    "translationId",
    "type",
    "unupdatable",
    "volumeUnits",
    "zip"
  ]
}
```

## E2 — ACCEPTED

**Question:** Can a Feature Studio be created and its contents set and read back byte-for-byte?

**Detail:**

```json
{
  "featureStudioId": "a11ce0000000000000000114",
  "contentsRoundTripByteIdentical": true,
  "sourceByteLength": 2902,
  "storedByteLength": 2902,
  "microversionSources": {
    "setContentsResponse": null,
    "readContentsResponse": null,
    "elementsListing": "a11ce0000000000000000030",
    "documentCurrentMicroversion": "a11ce0000000000000000054",
    "documentCurrentMicroversionBefore": "a11ce0000000000000000074"
  },
  "chosenFeatureStudioMicroversion": "a11ce0000000000000000030"
}
```

## E3 — ACCEPTED

**Question:** Which plane-parameter shape does Onshape accept when adding a referenceImage feature instance?

**Attempts:**

```json
[
  {
    "variant": "a",
    "description": "captured qCompressed Top-plane queryString with deterministicIds [\"JDC\"]",
    "status": 200,
    "featureStatus": "OK",
    "featureId": "FycByd6CdezIhLo_0",
    "message": null
  }
]
```

**Detail:**

```json
{
  "featureId": "FycByd6CdezIhLo_0",
  "acceptedPlaneVariant": "a",
  "acceptedPlaneVariantDescription": "captured qCompressed Top-plane queryString with deterministicIds [\"JDC\"]",
  "requestImageNamespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
  "requestFeatureNamespace": "ea11ce0000000000000000114::ma11ce0000000000000000030",
  "storedImageNamespace": "ea11ce0000000000000000120::ma11ce0000000000000000010",
  "storedFeatureNamespace": "ea11ce0000000000000000114::ma11ce0000000000000000030",
  "storedPlaneParameter": {
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
  "acceptedRequestShape": {
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
  },
  "storedFeature": {
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
}
```

## E4 — ACCEPTED

**Question:** Does Onshape accept a client-authored image namespace and actually rebind the image?

**Attempts:**

```json
[
  {
    "variant": "a",
    "namespace": "ea11ce0000000000000000026::ma11ce0000000000000000125",
    "description": "element + microversion, the same style that worked in E3",
    "status": null,
    "featureStatus": "OK",
    "storedNamespace": "ea11ce0000000000000000026::ma11ce0000000000000000125",
    "rebound": true,
    "message": null
  },
  {
    "variant": "b",
    "namespace": "ea11ce0000000000000000026",
    "description": "element segment only",
    "status": null,
    "featureStatus": "ERROR",
    "storedNamespace": "ea11ce0000000000000000026",
    "rebound": true,
    "message": null
  },
  {
    "variant": "c",
    "namespace": "da11ce0000000000000000039::wa11ce0000000000000000052::ea11ce0000000000000000026::ma11ce0000000000000000125",
    "description": "document + workspace + element + microversion",
    "status": null,
    "featureStatus": "ERROR",
    "storedNamespace": "da11ce0000000000000000039::wa11ce0000000000000000052::ea11ce0000000000000000026::ma11ce0000000000000000125",
    "rebound": true,
    "message": null
  }
]
```

**Detail:**

```json
{
  "secondBlobElementId": "a11ce0000000000000000026",
  "acceptedNamespaceForm": "ea11ce0000000000000000026::ma11ce0000000000000000125",
  "acceptedNamespaceVariant": "a"
}
```

## E5 — ACCEPTED

**Question:** Is "suppressed" the field that suppresses a BTMFeature, and does it round-trip?

**Attempts:**

```json
[
  {
    "requested": true,
    "status": null,
    "featureStatus": "OK",
    "storedSuppressed": true,
    "storedHasSuppressedKey": true,
    "message": null
  },
  {
    "requested": false,
    "status": null,
    "featureStatus": "ERROR",
    "storedSuppressed": false,
    "storedHasSuppressedKey": true,
    "message": null
  }
]
```

**Detail:**

```json
{
  "fieldName": "suppressed"
}
```
