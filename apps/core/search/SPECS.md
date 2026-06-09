#
# Global Search
#

Objective: Ability to search content across services

* Check Redis for recent searches, refresh TTL, and return.
* Put search request onto SQS
* Each service listens for those (if implemented).
* Websocket would have to be accountId and userID specific.
* How to support it if just done via API request?  Maybe not.
* TTL on overall request
* Kill requests if the user switches accounts, roles or logs out.

* Each record must carry:
* accountId
* access level by table

AWS OpenSearch
search -> event bridge ->
Redis for cache

MORE is needed to be considered here....

